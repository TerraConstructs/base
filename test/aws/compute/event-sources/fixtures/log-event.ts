 
async function handler(event: any) {
  console.log("event:", JSON.stringify(event, undefined, 2));
  return { event };
}
