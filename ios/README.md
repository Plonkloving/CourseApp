# iOS 未签名工程

`CourseSchedule.xcodeproj` 是不依赖第三方包的原生 UIKit + WKWebView 工程，最低支持 iOS 15。它与 Android 工程复用仓库根目录的 `app/` 页面资源。

## 本地构建

1. 在 macOS 的 Xcode 中打开 `CourseSchedule.xcodeproj`。
2. 选择 `CourseSchedule` target。
3. 如需真机安装，在 Signing & Capabilities 中选择自己的 Team，并将 Bundle Identifier 改为该账户可用的唯一值。
4. 未配置签名时只能构建模拟器版本，或生成供后续签名的未签名 IPA。

构建阶段只复制 `app/` 页面资源，不读取或打包 `data/` 中的任何课表。首次安装显示空课表。

1.3.0 首次启动会执行一次隐私迁移，清除旧版本课程状态，避免历史内置数据继续显示。

GitHub Actions 中的 `CourseSchedule-iOS-unsigned.ipa` 没有苹果签名，不能直接安装到普通 iPhone。后续可在工作流中增加证书和描述文件 Secrets，生成 Ad Hoc 签名包。
