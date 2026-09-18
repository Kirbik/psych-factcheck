export interface ContentReference {
  readonly externalId: string;
  readonly mediaUrl: string;
  readonly publishedAt?: Date;
}

export interface ContentProvider {
  getContent(reference: string): Promise<ContentReference>;
}
