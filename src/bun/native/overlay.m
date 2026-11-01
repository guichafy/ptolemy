#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>

// Delegate that hides the window instead of closing it
@interface OverlayWindowDelegate : NSObject <NSWindowDelegate>
@property (nonatomic, weak) id originalDelegate;
@end

// Callback invoked from native back into bun whenever the overlay window
// becomes key (firstResponder ready). Bun registers this via
// `setWindowShowCallback` — the mainview uses it to focus the search input
// and refresh the Claude session list without depending on webview-side
// visibility events.
typedef void (*WindowShowCallback)(void);
static WindowShowCallback windowShowCallback = NULL;

@implementation OverlayWindowDelegate

- (BOOL)windowShouldClose:(NSWindow *)sender {
    // Hide the window instead of closing
    [sender makeFirstResponder:nil];
    [sender orderOut:nil];
    return NO;
}

- (void)windowDidResignKey:(NSNotification *)notification {
    NSWindow *window = notification.object;
    NSLog(@"[Delegate] windowDidResignKey. before isVisible=%d alpha=%.2f firstResp=%@", [window isVisible], [window alphaValue], NSStringFromClass([[window firstResponder] class]));
    [window makeFirstResponder:nil];
    [window setAlphaValue:0.0];
    [window orderOut:nil];
    NSLog(@"[Delegate] windowDidResignKey. after  isVisible=%d alpha=%.2f", [window isVisible], [window alphaValue]);
}

- (void)windowDidBecomeKey:(NSNotification *)notification {
    NSLog(@"[Delegate] windowDidBecomeKey");
    if (windowShowCallback) {
        windowShowCallback();
    }
    if ([self.originalDelegate respondsToSelector:@selector(windowDidBecomeKey:)]) {
        [self.originalDelegate windowDidBecomeKey:notification];
    }
}

// Forward any other delegate methods to the original delegate
- (BOOL)respondsToSelector:(SEL)aSelector {
    if (aSelector == @selector(windowShouldClose:)) return YES;
    if (aSelector == @selector(windowDidResignKey:)) return YES;
    if (aSelector == @selector(windowDidBecomeKey:)) return YES;
    if (self.originalDelegate && [self.originalDelegate respondsToSelector:aSelector]) return YES;
    return [super respondsToSelector:aSelector];
}

- (id)forwardingTargetForSelector:(SEL)aSelector {
    if (self.originalDelegate && [self.originalDelegate respondsToSelector:aSelector]) {
        return self.originalDelegate;
    }
    return [super forwardingTargetForSelector:aSelector];
}

@end

static OverlayWindowDelegate *overlayDelegate = nil;
static NSWindow *registeredWindow = nil;
static EventHotKeyRef hotKeyRef = NULL;
static EventHandlerRef hotKeyHandlerRef = NULL;

// Carbon hotkeys can multi-fire under certain WKWebView + window-level
// configurations — observed in production as 10+ fires within ~50ms for a
// single physical keypress, sending the window into a show/hide pingpong.
// 200ms is below typical human double-tap (~300ms) but well above any
// observed repeat burst.
static const NSTimeInterval HOTKEY_DEBOUNCE_S = 0.20;
static NSTimeInterval lastHotkeyAt = 0;

// Forward declaration
void makeWindowOverlay(void *nsWindowPtr);

static OSStatus hotkeyHandler(EventHandlerCallRef nextHandler, EventRef event, void *userData) {
    (void)nextHandler;
    (void)event;
    (void)userData;
    NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
    NSTimeInterval elapsed = now - lastHotkeyAt;
    if (elapsed < HOTKEY_DEBOUNCE_S) {
        NSLog(@"[Hotkey] debounced (elapsed=%.0fms)", elapsed * 1000);
        return noErr;
    }
    lastHotkeyAt = now;
    if (registeredWindow) {
        BOOL visible = [registeredWindow isVisible];
        BOOL key = [registeredWindow isKeyWindow];
        NSLog(@"[Hotkey] fired. isVisible=%d isKey=%d", visible, key);
        if (visible) {
            NSLog(@"[Hotkey] -> hide path");
            dispatch_async(dispatch_get_main_queue(), ^{
                NSLog(@"[Hotkey] hide dispatch: before isVisible=%d alpha=%.2f firstResp=%@", [registeredWindow isVisible], [registeredWindow alphaValue], NSStringFromClass([[registeredWindow firstResponder] class]));
                // Resign first responder before orderOut. When the WKWebView's
                // <input> is focused with typed content + an active caret, the
                // WebKit text-input session keeps the compositor layer "live"
                // — orderOut + alpha=0 alone leave a stale visual on screen.
                // makeFirstResponder:nil ends the text-input session so the
                // subsequent orderOut actually removes the visual.
                [registeredWindow makeFirstResponder:nil];
                [registeredWindow setAlphaValue:0.0];
                [registeredWindow orderOut:nil];
                NSLog(@"[Hotkey] hide dispatch: after  isVisible=%d alpha=%.2f", [registeredWindow isVisible], [registeredWindow alphaValue]);
            });
        } else {
            NSLog(@"[Hotkey] -> show path");
            // windowShowCallback is invoked from windowDidBecomeKey: in the
            // delegate, after the WKWebView is firstResponder — the only
            // point where DOM .focus() in the renderer actually takes effect.
            makeWindowOverlay((__bridge void *)registeredWindow);
        }
    }
    return noErr;
}

void setWindowShowCallback(void *cb) {
    windowShowCallback = (WindowShowCallback)cb;
}

void makeWindowOverlay(void *nsWindowPtr) {
    if (!nsWindowPtr) return;
    NSWindow *window = (__bridge NSWindow *)nsWindowPtr;
    dispatch_async(dispatch_get_main_queue(), ^{
        // Install or re-install delegate to intercept close
        if (window.delegate != overlayDelegate) {
            if (!overlayDelegate) {
                overlayDelegate = [[OverlayWindowDelegate alloc] init];
            }
            overlayDelegate.originalDelegate = window.delegate;
            window.delegate = overlayDelegate;
        }

        [window setOpaque:NO];
        [window setBackgroundColor:[[NSColor blackColor] colorWithAlphaComponent:0.85]];
        [window setCollectionBehavior:
            NSWindowCollectionBehaviorMoveToActiveSpace |
            NSWindowCollectionBehaviorFullScreenAuxiliary];
        [window setLevel:NSStatusWindowLevel];

        // Center window on the screen under the pointer, falling back to main.
        NSScreen *screen = nil;
        NSPoint mouse = [NSEvent mouseLocation];
        for (NSScreen *candidate in [NSScreen screens]) {
            if (NSPointInRect(mouse, [candidate frame])) {
                screen = candidate;
                break;
            }
        }
        if (!screen) {
            screen = [NSScreen mainScreen];
        }
        if (screen) {
            NSRect screenFrame = [screen visibleFrame];
            NSRect windowFrame = [window frame];
            CGFloat x = NSMidX(screenFrame) - windowFrame.size.width / 2;
            CGFloat y = NSMidY(screenFrame) - windowFrame.size.height / 2;
            [window setFrameOrigin:NSMakePoint(x, y)];
        }

        // makeKeyAndOrderFront: (not orderFrontRegardless) is required: in
        // the hotkey-hide → hotkey-show path the app stays `active` the whole
        // time, so [NSApp activateIgnoringOtherApps:] is a no-op and
        // orderFrontRegardless leaves the window visible-but-not-key.
        // setAlphaValue restores visibility after the hide path zeroed it
        // out — a defense against the WKWebView/StatusWindowLevel quirk
        // where orderOut leaves a stale visual on screen until the next
        // event drains the run loop.
        [window setAlphaValue:1.0];
        [NSApp activateIgnoringOtherApps:YES];
        [window makeKeyAndOrderFront:nil];
        // windowShowCallback fires from windowDidBecomeKey: in the delegate —
        // the only point where the WKWebView is firstResponder and DOM
        // .focus() actually takes effect.
    });
}


int registerHotkey(void *nsWindowPtr) {
    if (!nsWindowPtr) return paramErr;
    registeredWindow = (__bridge NSWindow *)nsWindowPtr;

    if (hotKeyRef) {
        UnregisterEventHotKey(hotKeyRef);
        hotKeyRef = NULL;
    }

    if (!hotKeyHandlerRef) {
        EventTypeSpec eventType = { kEventClassKeyboard, kEventHotKeyPressed };
        OSStatus handlerStatus = InstallApplicationEventHandler(&hotkeyHandler, 1, &eventType, NULL, &hotKeyHandlerRef);
        if (handlerStatus != noErr) {
            NSLog(@"[Hotkey] Failed to install hotkey handler: %d", (int)handlerStatus);
            return (int)handlerStatus;
        }
    }

    // Command+Shift+Space: kVK_Space=49, cmdKey+shiftKey
    EventHotKeyID hotKeyID = { 'PTol', 1 };
    UInt32 modifiers = cmdKey | shiftKey;
    OSStatus status = RegisterEventHotKey(49, modifiers, hotKeyID,
                                          GetApplicationEventTarget(), 0, &hotKeyRef);
    if (status == noErr) {
        NSLog(@"[Hotkey] Command+Shift+Space registered successfully");
    } else {
        NSLog(@"[Hotkey] Failed to register hotkey: %d", (int)status);
    }
    return (int)status;
}

int isMainWindowVisible(void) {
    if (!registeredWindow) return 0;
    return [registeredWindow isVisible] ? 1 : 0;
}

void unregisterHotkey(void) {
    if (hotKeyRef) {
        UnregisterEventHotKey(hotKeyRef);
        hotKeyRef = NULL;
    }
    if (hotKeyHandlerRef) {
        RemoveEventHandler(hotKeyHandlerRef);
        hotKeyHandlerRef = NULL;
    }
    registeredWindow = nil;
    windowShowCallback = NULL;
}

// Override the NSStatusItem length to control the menu bar slot width.
// Electrobun's `width`/`height` only resize the rendered image — the slot length
// is independent and defaults to a value Electrobun chooses. We accept the FFI
// pointer Electrobun returns from createTray (a wrapper around NSStatusItem)
// and walk to the NSStatusItem via either direct cast or a `statusItem` getter.
void setTrayLength(void *trayPtr, double length) {
    if (!trayPtr) return;
    id obj = (__bridge id)trayPtr;
    dispatch_async(dispatch_get_main_queue(), ^{
        NSStatusItem *item = nil;
        if ([obj isKindOfClass:[NSStatusItem class]]) {
            item = (NSStatusItem *)obj;
        } else if ([obj respondsToSelector:@selector(statusItem)]) {
            #pragma clang diagnostic push
            #pragma clang diagnostic ignored "-Warc-performSelector-leaks"
            item = (NSStatusItem *)[obj performSelector:@selector(statusItem)];
            #pragma clang diagnostic pop
        }
        if (item) {
            [item setLength:length];
        } else {
            NSLog(@"[Tray] setTrayLength: cannot resolve NSStatusItem from %@", NSStringFromClass([obj class]));
        }
    });
}

void quitApp(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        unregisterHotkey();
        [NSApp terminate:nil];
    });
}

// MCP credentials stay in the app's Keychain service. No subprocess/argv or log
// carries secret data. The caller owns buffers and receives only bounded status.
#import <Security/Security.h>
#include <string.h>

static NSMutableDictionary *mcpSecretQuery(const char *account) {
    if (!account) return nil;
    NSString *name = [NSString stringWithUTF8String:account];
    if (!name) return nil;
    return [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
              (__bridge id)kSecAttrService: @"com.ptolomeu.app.mcp",
              (__bridge id)kSecAttrAccount: name} mutableCopy];
}

int32_t mcpReadSecret(const char *account, void *output, uint32_t capacity) {
    @autoreleasepool {
        NSMutableDictionary *query = mcpSecretQuery(account);
        if (!query || !output) return -2;
        query[(__bridge id)kSecReturnData] = @YES;
        query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
        CFTypeRef result = NULL;
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
        if (status == errSecItemNotFound) return -1;
        if (status != errSecSuccess) { if (result) CFRelease(result); return -2; }
        NSData *data = CFBridgingRelease(result);
        if (![data isKindOfClass:[NSData class]] || data.length > capacity) return -2;
        if (data.length > 0) memcpy(output, data.bytes, data.length);
        return (int32_t)data.length;
    }
}

int32_t mcpWriteSecret(const char *account, const void *bytes, uint32_t length) {
    @autoreleasepool {
        NSMutableDictionary *query = mcpSecretQuery(account);
        if (!query || (!bytes && length > 0) || length > 1024 * 1024) return -2;
        NSData *data = [NSData dataWithBytes:bytes length:length];
        NSDictionary *attributes = @{(__bridge id)kSecValueData: data};
        OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
        if (status == errSecItemNotFound) {
            query[(__bridge id)kSecValueData] = data;
            query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
            status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
        }
        return status == errSecSuccess ? 0 : -2;
    }
}

int32_t mcpDeleteSecret(const char *account) {
    @autoreleasepool {
        NSMutableDictionary *query = mcpSecretQuery(account);
        if (!query) return -2;
        OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
        return status == errSecSuccess || status == errSecItemNotFound ? 0 : -2;
    }
}
