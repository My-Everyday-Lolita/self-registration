const Koa = require('koa');
const Router = require('koa-joi-router');
const ratelimit = require('koa-ratelimit');
const axios = require('axios');
const cors = require('@koa/cors');

const app = new Koa();
const db = new Map();
const router = Router();
const Joi = Router.Joi;

let accessToken = undefined;

function connect() {
  const data = new URLSearchParams();
  data.append('client_id', process.env.KEYCLOAK_CLIENT_ID || 'admin-cli');
  data.append('grant_type', 'client_credentials');
  data.append('client_secret', process.env.KEYCLOAK_CLIENT_SECRET);
  return axios({
    method: 'post',
    url: `${process.env.DOMAIN || 'http://localhost:8080'}/auth/realms/master/protocol/openid-connect/token`,
    data,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
}

function register(data) {
  return axios({
    method: 'post',
    url: `${process.env.DOMAIN || 'http://localhost:8080'}/auth/admin/realms/${process.env.KEYCLOAK_REALM || 'my-everyday-lolita'}/users`,
    data: {
      enabled: true,
      username: data.username,
      email: data.email,
      credentials: [
        {
          type: 'password',
          value: data.password,
          temporary: false
        }
      ]
    },
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}

const selfRegistrationSchema = Joi.object({
  username: Joi.string().max(100).required(),
  email: Joi.string().email({ tlds: false }).required(),
  password: Joi.string().pattern(/^(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])(?=\S+).{8,20}$/).required(),
  confirmPassword: Joi.ref('password'),
}).with('password', 'confirmPassword');

router.route({
  method: 'post',
  path: '/register',
  validate: {
    body: selfRegistrationSchema,
    type: 'json'
  },
  handler: async (ctx) => {
    let cr;
    if (!accessToken) {
      cr = await connect();
      accessToken = cr.data.access_token;
    }
    try {
      await register(ctx.request.body);
      ctx.status = 201;
      ctx.body = { successMessage: 'OK' };
    } catch (error) {
      if (error.response.status === 401) {
        cr = await connect();
        accessToken = cr.data.access_token;
        try {
          await register(ctx.request.body);
          ctx.status = 201;
          ctx.body = { successMessage: 'OK' };
        } catch (error) {
          ctx.status = error.response.status;
          ctx.body = error.response.data;
        }
      } else {
        ctx.status = error.response.status;
        ctx.body = error.response.data;
      }
    }
  }
});

app.use(ratelimit({
  driver: 'memory',
  db: db,
  duration: process.env.RATE_LIMIT_DURATION || 3600000,
  errorMessage: 'Sometimes You Just Have to Slow Down.',
  id: (ctx) => ctx.ip,
  headers: {
    remaining: 'Rate-Limit-Remaining',
    reset: 'Rate-Limit-Reset',
    total: 'Rate-Limit-Total'
  },
  max: process.env.RATE_LIMIT_MAX || 10,
  disableHeader: false,
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(' ');

app.use(cors({
  origin: (ctx) => {
    return allowedOrigins.includes(ctx.header.origin) ? ctx.header.origin : '';
  }
}));

app.use(router.middleware());
console.table(router.routes.map(route => ({ path: route.path, methods: route.method })))

// run server
app.listen(
  process.env.PORT || 3000,
  () => console.log(`listening on port ${process.env.PORT || 3000}`)
);
