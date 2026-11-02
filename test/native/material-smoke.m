#import <AppKit/AppKit.h>
#include <assert.h>
extern void configureWindowMaterial(void *, int);
static void drain(void) { [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]]; }
static NSUInteger countGlass(NSView *view) { NSUInteger total=[view isKindOfClass:NSClassFromString(@"NSGlassEffectView")]?1:0;for(NSView *child in view.subviews)total+=countGlass(child);return total; }
int main(void) { @autoreleasepool {
 [NSApplication sharedApplication];
 NSWindow *window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,630,540) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
 NSView *original=window.contentView;
 configureWindowMaterial((__bridge void *)window,1);drain();
 assert([NSStringFromClass(window.contentView.class) isEqualToString:@"PtolemyMaterialHost"]);
 NSView *host=window.contentView;
 for(int i=0;i<4;i++){configureWindowMaterial((__bridge void *)window,1);drain();assert(window.contentView==host);}
 assert(countGlass(host)<=1);assert(original.window==window);
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000 && !defined(PTOLEMY_FORCE_VIBRANCY)
 if (@available(macOS 26.0, *)) { if (!NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency) assert(countGlass(host)==1); }
#endif
 [window setContentSize:NSMakeSize(1080,760)];drain();
 assert(fabs(original.frame.size.width-1080)<1);assert(fabs(original.frame.size.height-760)<1);
 window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameAqua];drain();
 window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];drain();
 assert(original.window==window);assert(!window.isOpaque);
 NSLog(@"PTOLEMY_MATERIAL_SMOKE_OK: idempotence, content ownership, resize, light/dark, transparent window");
 return 0;
} }
