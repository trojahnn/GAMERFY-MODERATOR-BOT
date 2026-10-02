# The image for a container host (Bunny Magic Containers runs linux/amd64).
# The app has no dependencies: Node 22 already brings `fetch` and `WebSocket`,
# so there is nothing to install and nothing to build.
FROM node:22-bookworm-slim
WORKDIR /app
# In a container the page listens on every interface, on port 80; the host's
# edge is what faces the internet. The installations live in /data, which has
# to be a volume: without one, every restart forgets who installed the app.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=80 \
    DATA_DIR=/data
RUN mkdir -p /data
COPY package.json rules.md ./
COPY src ./src
# GAMERFY_CLIENT_ID, AI_GATEWAY_API_KEY and PUBLIC_URL come from the container's
# environment, never from the build.
EXPOSE 80
CMD ["node", "src/index.mjs"]
