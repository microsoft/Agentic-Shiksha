# EkalaivaWeb/frontend/Dockerfile

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
RUN npm ci && test -x node_modules/.bin/tsc

COPY . .

ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_DASHBOARD_API_URL=http://localhost:8050
ARG VITE_AZURE_CLIENT_ID=
ARG VITE_AZURE_TENANT_ID=common
ARG VITE_AZURE_REDIRECT_URI=http://localhost:5173
ARG VITE_USE_AGUI=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_DASHBOARD_API_URL=$VITE_DASHBOARD_API_URL \
    VITE_AZURE_CLIENT_ID=$VITE_AZURE_CLIENT_ID \
    VITE_AZURE_TENANT_ID=$VITE_AZURE_TENANT_ID \
    VITE_AZURE_REDIRECT_URI=$VITE_AZURE_REDIRECT_URI \
    VITE_USE_AGUI=$VITE_USE_AGUI

# The CSP connect-src must name the Vite API origin. Build arguments inject
# deployment values without copying a production dotenv file into the image.
RUN set -eu; \
    BACKEND_ORIGIN="$(printf '%s' "$VITE_API_BASE_URL" | tr -d '\r' | sed 's:[[:space:]]*$::; s:/*$::')"; \
    test -n "$BACKEND_ORIGIN"; \
    sed "s|\${BACKEND_ORIGIN}|$BACKEND_ORIGIN|g" nginx.conf.template | tr -d '\r' > nginx.conf; \
    ! grep -q 'BACKEND_ORIGIN' nginx.conf

# `npm run` resolves tsc/vite from node_modules/.bin; npx would hit the registry instead.
RUN npm run build

########################
# 2) Serve stage
########################
FROM nginx:stable-alpine

# Remove default config and add our own (generated in the build stage)
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
# If CRA, change dist -> build
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]