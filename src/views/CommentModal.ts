import {Modal, type App} from 'obsidian';

export class CommentModal extends Modal {
	private onSave: (body: string) => void;
	private initialBody: string;
	private modalTitle: string | undefined;
	private textareaEl: HTMLTextAreaElement;

	constructor(app: App, onSave: (body: string) => void, existingBody?: string, title?: string) {
		super(app);
		this.onSave = onSave;
		this.initialBody = existingBody ?? '';
		this.modalTitle = title;
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.addClass('marginalia-modal');

		contentEl.createEl('h3', {
			text: this.modalTitle ?? (this.initialBody ? 'Edit comment' : 'Add comment'),
		});

		this.textareaEl = contentEl.createEl('textarea', {
			cls: 'marginalia-modal-textarea',
			attr: {placeholder: 'Write your comment (Markdown supported)...'},
		});
		this.textareaEl.value = this.initialBody;

		const buttonRow = contentEl.createDiv({cls: 'marginalia-modal-buttons'});

		const saveBtn = buttonRow.createEl('button', {
			text: 'Save',
			cls: 'mod-cta',
		});
		saveBtn.addEventListener('click', () => this.save());

		const cancelBtn = buttonRow.createEl('button', {text: 'Cancel'});
		cancelBtn.addEventListener('click', () => this.close());

		const hintEl = contentEl.createDiv({cls: 'marginalia-modal-hint'});
		// Keyboard shortcut hints use key names, not regular UI text
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		hintEl.textContent = 'Mod+Enter to save, Esc to cancel';

		// Mod+Enter to save
		this.scope.register(['Mod'], 'Enter', () => {
			this.save();
			return false;
		});

		// Focus textarea after modal opens
		setTimeout(() => this.textareaEl.focus(), 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private save(): void {
		const body = this.textareaEl.value.trim();
		if (body) {
			this.onSave(body);
		}
		this.close();
	}
}
