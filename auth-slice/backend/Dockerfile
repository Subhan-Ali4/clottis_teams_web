FROM node:22.13-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=4000
ENV DB_FILE=/data/auth.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 4000
CMD ["npm", "start"]
