# syntax=docker/dockerfile:1

# ---- 依赖 ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 构建静态站点 ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- 静态站点镜像（nginx）----
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# ---- 一次性复核镜像：代码检查 + 单元裁决 + 构建 + HTTP 冒烟 ----
FROM deps AS verify
COPY . .
ENV WEB_URL=http://web:80
CMD ["sh", "scripts/verify.sh"]
