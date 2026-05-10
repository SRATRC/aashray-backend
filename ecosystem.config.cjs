module.exports = {
  apps: [
    {
      name: 'MCPServer',
      script: './mcp-server/index.js',
      cwd: '/home/ubuntu/actions-runner-api/_work/aashray-backend/aashray-backend',
      interpreter: 'node',
      env_prod: {
        NODE_ENV: 'prod',
      },
    },
  ],
};
