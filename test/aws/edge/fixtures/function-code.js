function handler(event) {
  var request = event.request;
  var greeting = `Hello, ${request.uri}!`;
  return request;
}
