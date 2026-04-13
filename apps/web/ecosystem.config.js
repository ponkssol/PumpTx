module.exports = {
  apps: [
    {
      name: "frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",

      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
};