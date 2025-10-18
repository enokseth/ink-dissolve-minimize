EXT_UUID := pixel-dissolve-ink@final-guardians
BUILD_DIR := build
ZIP_BASENAME := $(EXT_UUID)
SCHEMA_DIR := schemas

# VERSION est fourni par le workflow (tag), sinon fallback 1
VERSION ?= 1

SRC_FILES := extension.js settings_data.js prefs.js metadata.json \
             $(SCHEMA_DIR)/org.gnome.shell.extensions.pixel-dissolve-ink.gschema.xml

all: clean compile-schemas pack

compile-schemas:
	@mkdir -p $(BUILD_DIR)/$(EXT_UUID)/schemas
	@cp $(SCHEMA_DIR)/org.gnome.shell.extensions.pixel-dissolve-ink.gschema.xml $(BUILD_DIR)/$(EXT_UUID)/schemas/
	@glib-compile-schemas $(BUILD_DIR)/$(EXT_UUID)/schemas

copy-sources:
	@mkdir -p $(BUILD_DIR)/$(EXT_UUID)
	@cp -a extension.js settings_data.js metadata.json $(BUILD_DIR)/$(EXT_UUID)/
	@[ -f prefs.js ] && cp prefs.js $(BUILD_DIR)/$(EXT_UUID)/ || true
	@cp -a $(SCHEMA_DIR) $(BUILD_DIR)/$(EXT_UUID)/

bump-version:
	@jq ".version=$(VERSION)" metadata.json > $(BUILD_DIR)/$(EXT_UUID)/metadata.json.tmp
	@mv $(BUILD_DIR)/$(EXT_UUID)/metadata.json.tmp $(BUILD_DIR)/$(EXT_UUID)/metadata.json

pack: copy-sources compile-schemas bump-version
	@cd $(BUILD_DIR) && zip -r "$(ZIP_BASENAME)-v$(VERSION).zip" "$(EXT_UUID)"

clean:
	@rm -rf $(BUILD_DIR)

.PHONY: all compile-schemas copy-sources bump-version pack clean
