# 简约图标 · v1

10 个身份、13 张道具，逐张独立绘制。绑匪与调包令沿用已确认版本。

- 原图：本目录下 `roles/`、`cards/`，透明 PNG；文件名对应游戏 ID。
- 预览：打开 [preview.html](preview.html)，每张同时展示浅底、深底及 32px 效果。
- 配色：砖红、炭灰、旧金；以器物和符号代替人物肖像。
- 明暗适配：图标底衬统一使用浅米色 `#f3eee3`，不要随深色主题变暗，也不要对图标应用反色。
- 本次是素材交付，尚未替换游戏现有图标。接入前建议生成小尺寸 WebP 以减少下载量，保留原图。
- 生成方式：内置 image_gen，每张独立调用；未使用 CLI 或外部 API。
- [manifest.json](manifest.json) 记录中文名、游戏 ID、文件位置及每张图案的主题提示词。

## 绘制提示词

每张使用以下公共提示词，加上 manifest 中的 subject；绑匪与调包令沿用前次同风格提示词。

```text
Use case: logo-brand. Asset type: small board-game UI pictogram, one standalone icon. Create a minimalist flat 2D game icon, square format, genuinely transparent background. Clean vector-like artwork made of only a few bold geometric shapes, consistent rounded contours. Palette restricted to muted brick red #A35B50, dark charcoal #34332F, antique gold #B99B59. Strong large simple silhouette legible at 32px. Restrained sophisticated board-game aesthetic. Centered with generous 18% padding. No text, letters, numbers, surrounding badge, background, full card template, human face, portrait, skin, hair or body. No realistic rendering, 3D, gradients, texture, shadows, sparkles or elaborate ornament. Purpose-designed small UI pictogram, not a detailed illustration. Subject: 
```
