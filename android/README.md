# Android 离线版

这是课程表的原生 Android 外壳。页面与 Excel 解析器在构建时直接打入 APK，但不包含任何课程数据；联网权限仅用于 GitHub Release 更新。

- 应用 ID：`com.local.courseschedule`
- 最低 Android 版本：Android 6.0（API 23）
- 当前版本：1.4.4（versionCode 13）
- 手机端修改位置：Android 应用私有 `SharedPreferences`
- 正常覆盖安装升级会保留修改；卸载应用会清除修改。
- 发布新版必须保持应用 ID 和发布签名不变，并递增 `versionCode`。
- 1.3.0 首次启动会执行一次隐私迁移，清除旧版本课程状态；1.4.3 升级时会删除旧图片识别密钥及其 Android Keystore 条目。
