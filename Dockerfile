FROM node:20-alpine AS builder
RUN npm install -g npm@11.4.1

WORKDIR /usr/src/app

COPY hardhat/package.json hardhat/package-lock.json* ./

RUN npm install --legacy-peer-deps 

COPY hardhat/ ./

RUN chmod +x ./scripts/*.js ./scripts/lib/*.js

CMD ["npm", "run", "execute_stages", "--", "--network", "cdkErigon"]
