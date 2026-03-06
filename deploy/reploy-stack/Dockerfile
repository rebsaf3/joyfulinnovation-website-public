FROM node:20-slim

WORKDIR /opt/reploy-stack

COPY . .

WORKDIR /opt/reploy-stack/app
RUN npm ci
RUN npm ci --prefix nyli-agent-swarm/nyli-agent-swarm/server
RUN npm ci --prefix nyli-agent-swarm/nyli-agent-swarm/client
RUN npm run build --prefix nyli-agent-swarm/nyli-agent-swarm/client

WORKDIR /opt/reploy-stack

ENV NODE_ENV=production
ENV PORT=3000
ENV MESH_PORT=3099
ENV STATE_ROOT=/data
ENV SWARM_DASHBOARD_AUTH=false

EXPOSE 3000 3099

CMD ["node", "scripts/stack-supervisor.js"]
