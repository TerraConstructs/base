function handler(event: any, _context: any, callback: any) {
  /* eslint-disable no-console */
  console.log("====================================================");
  console.log(JSON.stringify(event, undefined, 2));
  console.log("====================================================");
  return callback(undefined, event);
}
