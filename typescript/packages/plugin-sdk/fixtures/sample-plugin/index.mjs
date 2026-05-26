export default {
  manifest: {
    id: 'sample',
    version: '0.1.0',
    name: 'Sample Plugin',
    capabilities: ['tools'],
  },
  async register(ctx) {
    ctx.registerTool({
      definition: {
        name: 'plugin_ping',
        description: 'Ping from sample plugin',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      execute: async () => 'pong',
    });
  },
};
