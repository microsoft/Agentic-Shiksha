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

# The CSP connect-src must name the same origin Vite bakes into the bundle, so both
# are derived from VITE_API_BASE_URL; a mismatch silently blocks every API call.
# CRs are stripped throughout: a CRLF .env.production would otherwise embed one
# in the header value, which is illegal in an HTTP header.
RUN set -eu; \
    test -f .env.production || { echo "ERROR: Frontend/.env.production missing (see .env.production.example)"; exit 1; }; \
    BACKEND_ORIGIN="$(sed -n 's/^VITE_API_BASE_URL=//p' .env.production | head -1 | tr -d '\"\r' | sed 's:[[:space:]]*$::; s:/*$::')"; \
    test -n "$BACKEND_ORIGIN" || { echo "ERROR: VITE_API_BASE_URL is empty in .env.production"; exit 1; }; \
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