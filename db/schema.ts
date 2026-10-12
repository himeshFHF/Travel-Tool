import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const trips=sqliteTable("trips",{id:text("id").primaryKey(),payload:text("payload").notNull(),version:integer("version").notNull().default(1)});
export const members=sqliteTable("members",{userId:text("user_id").primaryKey(),name:text("name").notNull(),tripId:text("trip_id").notNull()});
export const documents=sqliteTable("documents",{id:text("id").primaryKey(),tripId:text("trip_id").notNull(),eventId:text("event_id"),name:text("name").notNull(),mime:text("mime").notNull(),size:integer("size").notNull()});
export const documentFingerprints=sqliteTable("document_fingerprints",{
  documentId:text("document_id").primaryKey().references(()=>documents.id,{onDelete:"cascade"}),
  tripId:text("trip_id").notNull(),sha256:text("sha256").notNull(),
},table=>[index("document_fingerprints_trip_hash").on(table.tripId,table.sha256)]);
