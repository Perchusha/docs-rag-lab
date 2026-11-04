/** What embeddings and the reranker read: the context, then the chunk. Claude only gets the chunk. */
export function contextualText(context: string | null, text: string): string {
  return context === null ? text : `${context}\n\n${text}`
}
