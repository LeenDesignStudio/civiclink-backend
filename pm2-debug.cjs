(async () => {
  console.log('DEBUG 1: launcher started');
  console.log('DEBUG PORT:', process.env.PORT);
  console.log('DEBUG APP_ENV:', process.env.APP_ENV);
  console.log('DEBUG DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');

  try {
    console.log('DEBUG 2: importing server...');
    const server = await import('./dist/server.js');
    console.log('DEBUG 3: server imported');
    console.log('DEBUG 4: calling start()...');
    await server.start();
    console.log('DEBUG 5: start() completed');
  } catch (error) {
    console.error('DEBUG ERROR:', error);
    process.exit(1);
  }
})();
