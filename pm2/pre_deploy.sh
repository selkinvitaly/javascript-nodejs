#!/bin/bash

chmod +x ./pm2/*.sh

#   rm -rf node_modules && npm i && find node_modules -name .git -delete && git add --force node_modules
git pull origin master &&
  NODE_ENV=production node --harmony `which gulp` build &&
  git add --force public manifest &&
  git commit -a -m deploy &&
  git push origin production

