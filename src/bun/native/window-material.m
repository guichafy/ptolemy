#import <AppKit/AppKit.h>

// Electrobun owns window.contentView and the webviews' immediate parent.
// Its resize/focus callbacks send ContainerView selectors to both. A material
// background must remain a sibling, never replace or reparent those views.
@interface PtolemyMaterialHost : NSView
@property (nonatomic, strong) NSView *material;
@property (nonatomic) BOOL palette;
@property (nonatomic) BOOL reducedTransparency;
- (void)updateMaterial;
@end

@implementation PtolemyMaterialHost
- (instancetype)initWithFrame:(NSRect)frame {
    self = [super initWithFrame:frame];
    if (self) {
        self.wantsLayer = YES;
        self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [[[NSWorkspace sharedWorkspace] notificationCenter] addObserver:self
            selector:@selector(accessibilityChanged:)
            name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
    }
    return self;
}
- (void)dealloc { [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:self]; }
- (NSView *)hitTest:(NSPoint)point { (void)point; return nil; }
- (void)accessibilityChanged:(NSNotification *)notification { (void)notification; [self updateMaterial]; }
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self updateMaterial]; }
- (void)updateMaterial {
    BOOL reduce = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
    if ((!reduce && !self.material) || reduce != self.reducedTransparency) {
        [self.material removeFromSuperview];
        self.material = nil;
        self.reducedTransparency = reduce;
        if (!reduce) {
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000 && !defined(PTOLEMY_FORCE_VIBRANCY)
            if (@available(macOS 26.0, *)) {
                NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:self.bounds];
                glass.style = NSGlassEffectViewStyleRegular;
                glass.cornerRadius = self.palette ? 28.0 : 0.0;
                self.material = glass;
            }
#endif
            if (!self.material) {
                NSVisualEffectView *vibrancy = [[NSVisualEffectView alloc] initWithFrame:self.bounds];
                vibrancy.material = NSVisualEffectMaterialPopover;
                vibrancy.blendingMode = NSVisualEffectBlendingModeBehindWindow;
                vibrancy.state = NSVisualEffectStateActive;
                self.material = vibrancy;
            }
            self.material.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
            [self addSubview:self.material];
        }
    }
    self.layer.cornerRadius = self.palette ? 28.0 : 0.0;
    self.layer.masksToBounds = self.palette;
    [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
        self.layer.backgroundColor = (reduce ? NSColor.windowBackgroundColor : NSColor.clearColor).CGColor;
        BOOL contrast = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast;
        self.layer.borderWidth = contrast && self.palette ? 1.0 : 0.0;
        self.layer.borderColor = NSColor.separatorColor.CGColor;
    }];
    [self setNeedsLayout:YES];
}
- (void)layout {
    [super layout];
    self.material.frame = self.bounds;
    [self.window invalidateShadow];
}
@end

void configureWindowMaterial(void *nsWindowPtr, int palette) {
    if (!nsWindowPtr) return;
    NSWindow *window = (__bridge NSWindow *)nsWindowPtr;
    void (^configure)(void) = ^{
        NSView *content = window.contentView;
        if (!content) return;
        for (NSView *child in content.subviews) {
            if ([child isKindOfClass:PtolemyMaterialHost.class]) return;
        }
        PtolemyMaterialHost *host = [[PtolemyMaterialHost alloc] initWithFrame:content.bounds];
        host.palette = palette != 0;
        window.opaque = NO;
        window.backgroundColor = NSColor.clearColor;
        window.hasShadow = YES;
        content.wantsLayer = YES;
        content.layer.cornerRadius = host.palette ? 28.0 : 0.0;
        content.layer.masksToBounds = host.palette;
        [content addSubview:host positioned:NSWindowBelow relativeTo:nil];
        [host updateMaterial];
    };
    if (NSThread.isMainThread) configure();
    else dispatch_async(dispatch_get_main_queue(), configure);
}
