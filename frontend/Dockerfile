# Stage 1: Build the React application
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Security Audit during build
RUN npm install && (npm audit --audit-level=high || true)

COPY . .
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:alpine

# Copy built files from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config with proper cache-control headers
# - index.html: no-cache (always re-fetch to pick up new asset hashes)
# - /assets/*: immutable 1-year cache (hashed filenames change on every build)
# - sw.js: no-cache (service worker must always be fresh)
RUN printf 'server {\n\
    listen 3000;\n\
    server_name localhost;\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;\n\
\n\
    # Service worker — never cache\n\
    location = /sw.js {\n\
        root /usr/share/nginx/html;\n\
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";\n\
        add_header Pragma "no-cache";\n\
        expires -1;\n\
    }\n\
\n\
    # HTML entry point — never cache so new hashed JS/CSS always loads\n\
    location = /index.html {\n\
        root /usr/share/nginx/html;\n\
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";\n\
        add_header Pragma "no-cache";\n\
        expires -1;\n\
    }\n\
\n\
    # Hashed assets — cache forever (filename changes on every build)\n\
    location /assets/ {\n\
        root /usr/share/nginx/html;\n\
        add_header Cache-Control "public, max-age=31536000, immutable";\n\
        expires 1y;\n\
    }\n\
\n\
    # Proxy API requests to backend container directly via internal Docker DNS\n\
    location /api/ {\n\
        proxy_pass http://backend:8080/api/;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Upgrade $http_upgrade;\n\
        proxy_set_header Connection "upgrade";\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header X-Forwarded-Proto $scheme;\n\
        client_max_body_size 100M;\n\
    }\n\
\n\
    # Everything else — standard SPA fallback\n\
    location / {\n\
        root /usr/share/nginx/html;\n\
        index index.html;\n\
        try_files $uri $uri/ /index.html;\n\
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";\n\
    }\n\
}' > /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
