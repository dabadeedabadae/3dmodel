# FitCast web (Next.js). NEXT_PUBLIC_API_URL is baked in at build time: it is the API address AS THE BROWSER SEES IT.
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# on-device recognition runtime (onnxruntime-web wasm) — the model itself is committed in public/ml
RUN mkdir -p public/ort && cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs public/ort/ \
 && test -f public/ml/u2netp.onnx && test -f public/models/figures.json
ARG NEXT_PUBLIC_API_URL=http://localhost:3002
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN npx next build
ENV NODE_ENV=production
EXPOSE 3001
CMD ["npx", "next", "start", "-p", "3001"]
