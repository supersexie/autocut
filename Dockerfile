# Autocut server (ROLE=api or ROLE=worker): Node + ffmpeg (from ffmpeg-static) + Whisper as the
# backup to Deepgram (transformers.js, CPU).
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    AUTOCUT_DATA=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
# Caption/text fonts and the style presets shared with the app.
COPY fonts ./fonts
COPY legal ./legal
# The database tables (used as-is when DATABASE_URL isn't set: one server with a local database).
COPY supabase ./supabase
COPY app/src/lib/styles.json ./app/src/lib/styles.json
COPY scripts/warm-model.js ./scripts/warm-model.js
# Bake the Whisper model into the image.
RUN node scripts/warm-model.js

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
