ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /broker-code
COPY server.mjs admin.mjs mock.mjs view.mjs index.html client.js style.css check-view-stack.mjs ./
RUN mkdir /broker /control /state /app-ipc /view-secret && chown node:node /broker /control /state /app-ipc /view-secret
USER node
CMD ["node", "server.mjs"]
