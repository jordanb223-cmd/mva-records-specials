export const REQUESTS_LANG = "mva-requests";
export const SPECIALS_LANG = "mva-specials";

export interface Attachment {
	/** Vault path of the file. */
	file: string;
	kind: string;
	/** Whether the file goes into printed packets. */
	include: boolean;
}

export const ATTACHMENT_KINDS = [
	"Letter of representation",
	"HIPAA authorization",
	"Provider's authorization form",
	"Photo ID",
	"Records",
	"Bill / ledger",
	"Receipt",
	"Invoice",
	"Correspondence",
	"Other",
];

/** sent = out and waiting; partial = something came back but items are missing; complete = production is whole. */
export type ReceiptState = "sent" | "partial" | "complete";

export interface RecordRequest {
	id: string;
	provider: string;
	type: string;
	/** How the request went out (fax, mail, ...). */
	method: string;
	/** How the provider should send records back (encrypted email, mail, ...). */
	delivery: string;
	requested: string;
	followup: string;
	/** Date the letter asks the provider to produce by. */
	deadline: string;
	scopeFrom: string;
	scopeTo: string;
	categories: string;
	enclosures: string[];
	state: ReceiptState;
	received: string;
	missing: string[];
	cost: number | null;
	followups: string[];
	attachments: Attachment[];
	notes: string;
}

export type Relatedness = "yes" | "no" | "unknown";

/** One date of service with one provider. */
export interface Encounter {
	id: string;
	date: string;
	provider: string;
	service: string;
	related: Relatedness;
	relatedReason: string;
	records: boolean;
	bill: boolean;
	billed: number | null;
	planPaid: number | null;
	patientPaid: number | null;
	adjusted: number | null;
	lienHolder: string;
	lienAmount: number | null;
	collections: string;
	attachments: Attachment[];
	notes: string;
}

export type RequestStatus = "complete" | "partial" | "overdue" | "due-today" | "pending";

export interface MvaSettings {
	followUpDays: number;
	currency: string;
	playbookFolder: string;
	recordTypes: string[];
	requestMethods: string[];
	deliveryMethods: string[];
	enclosureTypes: string[];
	firmName: string;
	preparedBy: string;
	pageSize: "letter" | "a4";
	/** Folder for a case's files, relative to the case note's folder. {case} is the note name. */
	caseFilesFolder: string;
	/** Remembers the last choice in the report dialog. */
	lastPrivileged: boolean;
}

export const DEFAULT_SETTINGS: MvaSettings = {
	followUpDays: 30,
	currency: "USD",
	playbookFolder: "MVA Playbooks",
	recordTypes: ["Medical records", "Billing records", "Itemized bill", "Medical records and billing", "Imaging", "Mental health records", "Police report", "Wage records", "Other"],
	requestMethods: ["Fax", "Mail", "Email", "Portal", "Phone", "Records vendor", "Other"],
	deliveryMethods: ["Encrypted email", "Fax", "Mail", "Portal download", "CD / disc", "Other"],
	enclosureTypes: ["Letter of representation", "HIPAA authorization", "Provider's own authorization form", "Photo ID", "Copy of prior request"],
	firmName: "",
	preparedBy: "",
	pageSize: "letter",
	caseFilesFolder: "{case} files",
	lastPrivileged: false,
};
