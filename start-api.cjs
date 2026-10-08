(async () => {
  try {
    const server = await import('./dist/server.js');
    await server.start();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
