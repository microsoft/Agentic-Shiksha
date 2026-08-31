########################
# 1) Build stage
########################
FROM node:26-alpine AS build

WORKDIR /app

# The corporate TLS proxy blocks registry.npmjs.org. npm rewrites the lockfile's
# resolved hosts to this mirror; the update/audit/fund pings also go to the public
# registry and, when they fail, abort the install mid-link while still exiting 0.
ARG NPM_REGISTRY=https://packagefeedproxy.microsoft.io/npm/
ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

COPY package*.json ./
RUN npm ci && test -x node_modules/.bin/vite

COPY . .

ENV NODE_ENV=production
RUN npm run build

########################
# 2) Serve stage
########################
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
