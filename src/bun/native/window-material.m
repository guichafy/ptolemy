#import <AppKit/AppKit.h>

@interface PtolemyMaterialHost : NSView
@property (nonatomic, strong) NSView *originalContent;
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
- (void)accessibilityChanged:(NSNotification *)notification { (void)notification; [self updateMaterial]; }
- (void)viewDidChangeEffectiveAppearance { [super viewDidChangeEffectiveAppearance]; [self updateMaterial]; }
- (void)updateMaterial {
    if (!self.originalContent) return;
    BOOL reduce = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
    if (!self.originalContent.superview || (!reduce && !self.material) || reduce != self.reducedTransparency) {
        NSResponder *responder = self.window.firstResponder;
        [self.originalContent removeFromSuperview];
        [self.material removeFromSuperview];
        self.material = nil;
        self.reducedTransparency = reduce;
        if (!reduce) {
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000 && !defined(PTOLEMY_FORCE_VIBRANCY)
            if (@available(macOS 26.0, *)) {
                NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:self.bounds];
                glass.style = NSGlassEffectViewStyleRegular;
                glass.cornerRadius = self.palette ? 28.0 : 0.0;
                // Only contentView is guaranteed to sit inside the native glass.
                glass.contentView = self.originalContent;
                self.material = glass;
            }
#endif
            if (!self.material) {
                NSVisualEffectView *vibrancy = [[NSVisualEffectView alloc] initWithFrame:self.bounds];
                vibrancy.material = NSVisualEffectMaterialPopover;
                vibrancy.blendingMode = NSVisualEffectBlendingModeBehindWindow;
                vibrancy.state = NSVisualEffectStateActive;
                [vibrancy addSubview:self.originalContent];
                self.material = vibrancy;
            }
            self.material.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
            [self addSubview:self.material];
        } else {
            [self addSubview:self.originalContent];
        }
        self.originalContent.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        self.originalContent.frame = self.bounds;
        if (responder && responder != self.window) [self.window makeFirstResponder:responder];
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
    self.originalContent.frame = self.bounds;
    [self.window invalidateShadow];
}
@end

void configureWindowMaterial(void *nsWindowPtr, int palette) {
    if (!nsWindowPtr) return;
    NSWindow *window = (__bridge NSWindow *)nsWindowPtr;
    void (^configure)(void) = ^{
        if ([window.contentView isKindOfClass:PtolemyMaterialHost.class]) return;
        NSView *content = window.contentView;
        if (!content) return;
        PtolemyMaterialHost *host = [[PtolemyMaterialHost alloc] initWithFrame:content.bounds];
        host.palette = palette != 0;
        host.originalContent = content;
        window.opaque = NO;
        window.backgroundColor = NSColor.clearColor;
        window.hasShadow = YES;
        window.contentView = host;
        [host updateMaterial];
    };
    if (NSThread.isMainThread) configure();
    else dispatch_async(dispatch_get_main_queue(), configure);
}
