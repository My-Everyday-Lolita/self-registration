FROM node:lts-alpine
WORKDIR /usr/src/app
COPY . .
CMD ["node", "app.js"]
