# The configuration is baked into the image rather than bind-mounted: deployments are then
# self-contained and immutable, and nothing depends on host file-sharing permissions.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/nginx.conf
