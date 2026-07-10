export function parseEvent(story: string): string {
  const eventStart = story.indexOf("<event>");
  const eventEnd = story.indexOf("</event>");
  if (eventStart !== -1 && eventEnd !== -1) {
    return story.substring(eventStart + 7, eventEnd).trim();
  }
  return story;
}
