#import <AppKit/AppKit.h>
#include <assert.h>
extern void configureWindowMaterial(void *, int);

// Electrobun v1.16's window delegate reads abstractViews on contentView, and
// its resize implementation calls the webview's immediate parent. Keep both.
@interface ElectrobunContainerFixture : NSView
@property (nonatomic, strong) NSArray<NSView *> *abstractViews;
@property (nonatomic) NSUInteger resizeCalls;
- (void)updateActiveWebviewForMousePosition:(NSPoint)point;
@end
@implementation ElectrobunContainerFixture
- (void)updateActiveWebviewForMousePosition:(NSPoint)point { (void)point; self.resizeCalls++; }
@end
@interface ElectrobunDelegateFixture : NSObject <NSWindowDelegate>
@end
@implementation ElectrobunDelegateFixture
- (void)windowDidResize:(NSNotification *)notification {
    ElectrobunContainerFixture *container = (ElectrobunContainerFixture *)[notification.object contentView];
    for (NSView *child in container.abstractViews) {
        child.frame = container.bounds;
        [(ElectrobunContainerFixture *)child.superview updateActiveWebviewForMousePosition:NSZeroPoint];
    }
}
@end
static void drain(void) { [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]]; }
static NSUInteger countClass(NSView *view, Class cls) { NSUInteger total=[view isKindOfClass:cls]?1:0;for(NSView *child in view.subviews)total+=countClass(child,cls);return total; }
int main(void) { @autoreleasepool { @try {
    [NSApplication sharedApplication];
    NSWindow *window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,630,540) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    ElectrobunContainerFixture *original=[[ElectrobunContainerFixture alloc] initWithFrame:window.contentView.bounds];
    NSView *webview=[[NSView alloc] initWithFrame:original.bounds];
    webview.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    [original addSubview:webview]; original.abstractViews=@[webview]; window.contentView=original;
    ElectrobunDelegateFixture *delegate=[ElectrobunDelegateFixture new]; window.delegate=delegate;
    configureWindowMaterial((__bridge void *)window,1);drain();
    // This selector reproduces the framework's actual first-resize failure.
    assert([(ElectrobunContainerFixture *)window.contentView abstractViews].count==1);
    assert(window.contentView==original);assert(webview.superview==original);
    Class hostClass=NSClassFromString(@"PtolemyMaterialHost");
    for(int i=0;i<4;i++){configureWindowMaterial((__bridge void *)window,1);drain();assert(window.contentView==original);assert(countClass(original,hostClass)==1);}
    assert(countClass(original,NSClassFromString(@"NSGlassEffectView"))<=1);
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000 && !defined(PTOLEMY_FORCE_VIBRANCY)
    if (@available(macOS 26.0, *)) { if (!NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency) assert(countClass(original,NSClassFromString(@"NSGlassEffectView"))==1); }
#endif
    for(NSValue *value in @[[NSValue valueWithSize:NSMakeSize(1080,760)],[NSValue valueWithSize:NSMakeSize(630,244)],[NSValue valueWithSize:NSMakeSize(630,120)]]) {
        NSSize size=value.sizeValue; [window setContentSize:size];drain();
        assert(fabs(webview.frame.size.width-size.width)<1);assert(fabs(webview.frame.size.height-size.height)<1);
        assert(window.contentView==original);assert(webview.superview==original);
    }
    assert(original.resizeCalls>0);
    window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameAqua];drain();
    window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];drain();
    assert(webview.window==window);assert(!window.isOpaque);
    NSLog(@"PTOLEMY_MATERIAL_SMOKE_OK: Electrobun content/parent contract, idempotence, resize callbacks, light/dark");
    return 0;
} @catch(NSException *error) { NSLog(@"PTOLEMY_MATERIAL_SMOKE_FAIL: %@",error); return 1; } } }
