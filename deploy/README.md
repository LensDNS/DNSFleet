# deploy

## Docker 镜像

多阶段构建：**Node** 构建 Next 静态导出 → **Go** 嵌入 `internal/webui/dist` → **distroless** 运行时。定义见 [`Dockerfile`](Dockerfile)。构建上下文必须为**仓库根目录**（以便同时 `COPY web/` 与 Go 模块）。

示例（仓库根执行）：

```bash
docker build -f deploy/Dockerfile -t dnsfleet:local .
```

构建期如需把 **`NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH=1`** 打入前端 bundle（须与运行时 **`DNSFLEET_ADMIN_INSECURE_DISABLE=1`** 成对），使用 **`--build-arg`**，名称与 Dockerfile 中 **`ARG`** 一致。

若 Node 阶段 **`npm run build`** 未产出 **`web/out`**，后续 **`COPY --from=node`** 会失败；这比运行时才发现空 embed 更可取。

## Compose 一键运行

```bash
docker compose -f deploy/docker-compose.yml up --build
```

默认 **`8080:8080`**，SQLite 路径由 **`DNSFLEET_DB_PATH`** 指定（示例为 **`/data/dnsfleet.db`**）。完整环境变量表见根目录 [`README.md`](../README.md) **Configuration**（与 **`internal/config`** 一致）。

本地开发可用 `docker-compose.override.yml` 覆盖个人设置；该文件名已列入根目录 `.gitignore`。

### SQLite 数据卷与 `nonroot`（干净环境最易踩坑）

最终运行时镜像为 **`gcr.io/distroless/static-debian12:nonroot`**（进程 UID **65532**）。Compose **命名卷**挂载到 **`/data`** 时，卷根目录在容器内常见属主为 **root**；若 **`65532` 对 `/data` 无写权限**，**`OpenAndMigrate`** 无法创建或打开 **`dnsfleet.db`**，进程会启动失败或反复退出。

**做法一（接近生产）**：在首次启动前把卷内目录属主改为 **65532**（卷名一般为 **`<compose 项目名>_dnsfleet-data`**，可用 **`docker volume ls`** 核对）：

```bash
docker compose -f deploy/docker-compose.yml down
docker volume ls   # 找到形如 <项目名>_dnsfleet-data 的卷名
docker run --rm -v <volume_name>:/data busybox chown -R 65532:65532 /data
docker compose -f deploy/docker-compose.yml up -d
```

将 **`busybox`** 换为 **`alpine`** 亦可。须在能访问本机 Docker 引擎的环境中执行（Windows 上常用 WSL2 或已配置 Docker CLI 的终端）。该步骤**需要能拉取** `busybox` 或 `alpine` 等辅助镜像；离线或镜像白名单环境若无此类镜像，请改用**做法二**或**做法三**，或事先将所用镜像导入本机。

**做法二（仅本地 / 演示）**：使用合并文件 **`docker-compose.demo.yml`**，在容器内以 **root** 运行，免去对命名卷 **`chown`**（**禁止用于生产**）。**须与主 compose 一并指定**（下述双 `-f`）；**不要**单独 `-f deploy/docker-compose.demo.yml`，否则缺少 `build.context` 等服务定义，无法构建。

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.demo.yml up --build
```

**做法三**：改用**绑定挂载**到宿主机目录，并在宿主机上预先 **`mkdir`** 且将目录属主设为容器内 UID **65532**（跨平台时注意 WSL/VM 与路径一致性）。

### 健康检查（烟测）

容器启动后（替换端口若已映射）：

```bash
curl -fsS http://127.0.0.1:8080/healthz
```

期望响应体为纯文本 **`ok`**。

### 静态 UI 与 Admin 头

示例 compose 中的 **`DNSFLEET_ADMIN_TOKEN`** 仅为占位符，部署前须替换。若构建镜像时设置了 **`NEXT_PUBLIC_DNSFLEET_SKIP_ADMIN_AUTH=1`**，运行时须与 **`DNSFLEET_ADMIN_INSECURE_DISABLE=1`** 成对使用；仅靠运行时改后端环境变量**无法**改变已打入前端 bundle 的行为。

### 嵌入 UI 的 `HEAD` 响应（实现说明）

控制面在 **`internal/webui/serve.go`** 中对 **`HEAD`** 命中静态/SPA 路径时返回 **`echo.NoContent(http.StatusOK)`**，即 **HTTP 200** 与**空 body**（**不是** HTTP 204）。若需与 CDN 或严格客户端对齐 **`Content-Length`**（例如是否与 **`GET`** 使用同一 **`Stat` 长度**），可再单独收紧；当前未强制。

