FROM learnharness-browser:review-base
USER root
COPY browser-policy.json /etc/chromium/policies/managed/learnharness.json
COPY browser-start.py browser-http.mjs transfer.mjs gateway.py viewer.html viewer.js viewer.css /visual/
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3", "/visual/browser-start.py"]
