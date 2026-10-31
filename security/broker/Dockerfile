ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /broker-code
COPY server.mjs subscription.mjs subscription-transport.mjs egress.mjs admin.mjs mock.mjs view.mjs index.html client.js account.html account.js style.css check-view-stack.mjs ./
RUN mkdir /broker /control /state /app-ipc /view-secret /subscription /policy /egress && chown node:node /broker /control /state /app-ipc /view-secret /subscription /policy /egress
USER node
CMD ["node", "server.mjs"]
