FROM learnharness-web-app:visual-candidate AS app
FROM learnharness-browser:review-base
USER root
COPY --from=app /app/node_modules /app/node_modules
WORKDIR /app
COPY --chown=node:node . /app/security/render-worker/
RUN mkdir /render-ipc && chown node:node /render-ipc
USER node
ENTRYPOINT ["/usr/bin/tini","-s","--"]
CMD ["node","security/render-worker/server.mjs"]
