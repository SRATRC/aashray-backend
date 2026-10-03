module.exports = {
  apps: [
    {
      name: 'MCPServer',
      script: './mcp-server/index.js',
      cwd: process.env.APP_CWD || '/home/ubuntu/actions-runner-api/_work/aashray-backend/aashray-backend',
      interpreter: 'node',
      env_prod: {
        NODE_ENV: 'prod',
        MCP_PORT: process.env.MCP_PORT || '4000',
        MCP_BEARER_TOKEN: process.env.MCP_BEARER_TOKEN,
        LOG_DIR: process.env.LOG_DIR,
        MCP_DB_HOST: process.env.MCP_DB_HOST || process.env.DB_HOST,
        MCP_DB_PORT: process.env.MCP_DB_PORT || process.env.DB_PORT,
        MCP_DB_USER: process.env.MCP_DB_USER,
        MCP_DB_PASSWORD: process.env.MCP_DB_PASSWORD,
        MCP_DB_NAME: process.env.MCP_DB_NAME || process.env.DB_NAME,
      },
    },
  ],
};
