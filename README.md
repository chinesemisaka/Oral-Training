# 口腔客服智能陪练 MVP

这是一个用于口腔客服沟通训练的微信小程序 MVP。用户可以选择固定场景，与 DeepSeek 模拟的患者进行多轮对话，结束训练后获取自动评分报告，并在历史和数据页面查看训练记录。

项目由两部分组成：

- 微信小程序前端：根目录下的 `app.*`、`pages/`、`utils/` 和 `static/`。
- C++ 后端：`backend/`，使用 Crow、PostgreSQL 和 DeepSeek API。

> 本项目仅用于模拟训练，不构成医疗建议。请勿输入真实患者姓名、电话、病历或其他隐私信息。

## 1. 运行环境

当前后端使用 Windows API（WinHTTP）访问模型，推荐在 Windows 10/11 上运行。

新电脑需要安装：

1. [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. Git
3. Visual Studio 2022，并勾选“使用 C++ 的桌面开发”工作负载
4. CMake 3.20 或更高版本
5. PostgreSQL（当前开发环境使用 PostgreSQL 18）
6. 一个可用的 DeepSeek API Key

首次编译后端时，CMake 会从 GitHub 下载 Crow、Asio、nlohmann/json 和 libpqxx，因此需要能够访问 GitHub。

可在 PowerShell 中确认主要工具已安装：

```powershell
git --version
cmake --version
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' --version
```

如果 PostgreSQL 安装在其他版本或目录，请将本文命令中的路径替换为实际路径。

## 2. 获取项目

```powershell
git clone <项目仓库地址>
cd Oral-Training-codex-mvp
```

以下命令均假设当前目录是项目根目录。

## 3. 初始化 PostgreSQL

先确保 PostgreSQL 服务已经启动，然后以 PostgreSQL 管理员账号执行：

```powershell
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
& $psql -U postgres -c "CREATE ROLE oral_training_app LOGIN PASSWORD '请替换为本地数据库密码';"
& $psql -U postgres -c "CREATE DATABASE oral_training OWNER oral_training_app;"
```

如果用户或数据库已经存在，可以跳过对应命令。然后执行数据库迁移和场景初始化：

```powershell
& $psql -h 127.0.0.1 -p 5432 -U oral_training_app -d oral_training -f backend\migrations\001_initial.sql
```

命令会要求输入刚才设置的数据库密码。迁移可以重复执行，四个内置训练场景会自动新增或更新。

## 4. 编译后端

使用 Visual Studio 2022 生成并编译 Release 版本：

```powershell
cmake -S backend -B backend\build-msvc -G 'Visual Studio 17 2022' -A x64 `
  -DPostgreSQL_ROOT='C:/Program Files/PostgreSQL/18'
cmake --build backend\build-msvc --config Release
```

成功后程序位于：

```text
backend\build-msvc\Release\oral_training_backend.exe
```

如果首次配置时依赖下载中断，可以确认网络正常后重新执行 `cmake -S ...`。构建目录属于本机生成文件，不应提交到 Git。

## 5. 启动后端

后端直接读取当前进程的环境变量，不会自动加载 `backend/.env`。请在准备启动程序的同一个 PowerShell 窗口中执行：

```powershell
$env:DATABASE_URL='postgresql://oral_training_app:请替换为数据库密码@127.0.0.1:5432/oral_training'
$env:DEEPSEEK_API_KEY='请替换为 DeepSeek API Key'
$env:DEEPSEEK_MODEL='deepseek-v4-flash'
$env:ALLOW_RUNTIME_API_KEY='false'
$env:BIND_ADDRESS='127.0.0.1'
$env:PORT='8080'
$env:PATH='C:\Program Files\PostgreSQL\18\bin;' + $env:PATH
& '.\backend\build-msvc\Release\oral_training_backend.exe'
```

看到下面的信息表示服务已开始监听：

```text
Oral training API listening at http://127.0.0.1:8080/api
```

另开一个 PowerShell 窗口检查健康状态：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/health
```

返回数据中的 `database` 和 `modelConfigured` 应为 `true`。

### 本地临时配置模型密钥

如果不希望在启动命令中设置模型密钥，可在启动后端前设置：

```powershell
$env:ALLOW_RUNTIME_API_KEY='true'
```

随后可以在小程序首页输入 DeepSeek API Key。密钥只保存在当前后端进程内存中，后端退出后失效，不会写入小程序缓存、数据库或代码仓库。非本地环境必须设置 `ALLOW_RUNTIME_API_KEY=false`，并通过服务器环境变量管理密钥。

## 6. 在微信开发者工具中运行

1. 启动微信开发者工具，选择“导入项目”。
2. 选择本仓库根目录，不要只选择 `pages/` 或 `backend/`。
3. 如果当前微信账号不是仓库内 AppID 的项目成员，请换成自己的小程序 AppID；仅本地体验时也可以按开发者工具提示使用测试号。
4. 确认项目类型是“小程序”。
5. 保持后端 PowerShell 窗口运行，然后点击开发者工具顶部的“编译”。

本地开发环境默认请求：

```text
http://127.0.0.1:8080/api
```

该地址配置在 `utils/config.js`。`project.config.json` 已为本地调试关闭请求域名校验，因此通常不需要额外操作。

进入首页后：

1. 确认没有出现“后端服务不可用”的提示。
2. 点击“开始训练”。
3. 选择一个场景并开始对话。
4. 至少完成一轮对话后点击“结束训练”。
5. 在确认框中点击“结束评分”，等待生成训练报告。
6. 在“历史”和“数据”页确认记录已经保存。

## 7. 验证后端

后端运行时，可以执行不调用模型的基础冒烟测试：

```powershell
& '.\backend\tests\smoke.ps1'
```

配置有效 DeepSeek API Key 后，可测试完整的患者回复和评分流程：

```powershell
& '.\backend\tests\smoke.ps1' -WithModel
```

还可以运行 C++ 报告结构验证测试：

```powershell
ctest --test-dir backend\build-msvc -C Release --output-on-failure
```

完整模型冒烟测试会创建并完成一条训练记录。

## 8. 在其他设备或体验版中使用

### 同一局域网中的另一台电脑

如果微信开发者工具和后端不在同一台电脑：

1. 后端设置 `$env:BIND_ADDRESS='0.0.0.0'` 后重新启动。
2. 在 Windows 防火墙中仅对可信局域网开放 TCP 8080 端口。
3. 将 `utils/config.js` 中 `develop` 的地址改为后端电脑的局域网地址，例如 `http://192.168.1.20:8080/api`。
4. 确保两台电脑能够互相访问该地址。

不要把 PostgreSQL 端口直接暴露给其他设备；小程序只需要访问后端 API。

### 真机预览、体验版和正式版

手机上的 `127.0.0.1` 指向手机自身，不能访问电脑后端。真机或发布环境需要：

1. 将后端部署到可访问的服务器，并通过反向代理提供 HTTPS。
2. 设置后端 `BIND_ADDRESS=0.0.0.0` 和 `ALLOW_RUNTIME_API_KEY=false`。
3. 在微信公众平台把 HTTPS 域名加入小程序 `request` 合法域名。
4. 在 `utils/config.js` 中填写 `trial` 和 `release` 对应的 HTTPS API 地址，或通过小程序扩展配置提供 `apiBaseUrl`。
5. 不要在前端代码、Git 仓库或截图中保存 DeepSeek API Key 和数据库密码。

前端会主动拒绝体验版或正式版中的非 HTTPS API 地址。

## 9. 常见问题

### 首页提示后端服务不可用

- 确认后端进程仍在运行。
- 访问 `http://127.0.0.1:8080/api/health`。
- 检查 `DATABASE_URL`、PostgreSQL 服务和 `utils/config.js`。
- 如果使用其他电脑或手机，不能继续使用 `127.0.0.1`。

### 后端启动时找不到 PostgreSQL DLL

把 PostgreSQL 的 `bin` 目录加入当前 PowerShell 的 `PATH`，再启动程序：

```powershell
$env:PATH='C:\Program Files\PostgreSQL\18\bin;' + $env:PATH
```

### CMake 找不到 PostgreSQL

重新配置时显式指定安装目录：

```powershell
cmake -S backend -B backend\build-msvc -G 'Visual Studio 17 2022' -A x64 `
  -DPostgreSQL_ROOT='C:/实际安装目录/PostgreSQL/版本号'
```

### 对话返回为空或提示 JSON 解析失败

- 检查 DeepSeek API Key 是否有效且账户可用。
- 查看后端窗口输出的模型请求错误。
- 确认使用的是最新编译的 Release 程序；修改后端代码后需要重新执行 `cmake --build` 并重启进程。
- 可执行 `smoke.ps1 -WithModel` 单独复现模型调用。

### 点击“结束训练”没有反应

- 至少完成一轮患者与客服对话。
- 等待当前患者回复完成。
- 点击后应先出现确认框，再点击“结束评分”。
- 修改小程序文件后，需要在微信开发者工具中重新点击“编译”。

## 10. 目录结构

```text
.
├─ app.js / app.json / app.wxss    小程序全局配置和样式
├─ pages/                           首页、场景、训练、报告、历史和数据页面
├─ static/                          小程序运行时图片资源
├─ utils/api.js                     前端 API 请求封装
├─ utils/config.js                  不同小程序环境的 API 地址
├─ backend/src/main.cpp             C++ 后端入口和业务实现
├─ backend/migrations/              PostgreSQL 数据库迁移
├─ backend/tests/                   冒烟测试和报告验证测试
└─ docs/                            产品设计和 API 契约
```

接口详情参见 `docs/api.md`，后端补充说明参见 `backend/README.md`。

## 11. 开发注意事项

- 不要提交 `backend/.env`、真实密钥、数据库密码或本机构建目录。
- `project.private.config.json` 只应保存开发者工具生成的个人设置。
- 修改 `utils/config.js` 后，至少验证开发环境地址和发布环境 HTTPS 限制。
- 修改训练流程后，手动覆盖：开始训练、发送消息、续练、结束评分、查看报告、历史记录和数据汇总。
- 提交前运行 `git diff --check`，并在微信开发者工具中重新编译受影响页面。
