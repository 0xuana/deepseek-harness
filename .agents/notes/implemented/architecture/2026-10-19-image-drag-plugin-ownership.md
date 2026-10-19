# Agent Note: Image drag ownership outside the application layout

Status: implemented

English | [中文](2026-10-19-image-drag-plugin-ownership.zh.md)

## Problem

Image dragging spans conversation images, sidebar previews, and composer drop targets. Original files must survive source unmount during a drag, and failures must remain visible after the originating panel closes. An application-root image provider puts feature state in layout and makes independent image entries depend on an undeclared React ancestor.

## Decision

The [image-drag plugin](../../../../packages/client/ui-image-drag/README.md) owns browser transfer tokens, retained original files, desktop bridge selection, and transient failure feedback. Consumers receive narrow callbacks through their slot or Factory injection. The plugin registers its feedback through `shell.overlay`; layout declares the generic slot and has no image dependency. The shared image primitive owns preparation and gesture handlers with explicit action props.

## Alternatives considered

**Root React provider.** It preserves transfer lifetime but adds image-specific assembly to the layout package and hides dependencies from slot registration. Moving the same wrapper into the renderer would move the feature coupling into another generic owner.

**State on each image.** It avoids shared assembly but cannot deliver the retained file after the source unmounts or keep a late failure visible after the panel closes.

## Consequences

One plugin lifetime governs the transfer and window listener. Independent render roots can share a transfer without sharing a React ancestor. Custom compositions must load the service and declare the feedback slot; custom image Factory registrations must supply the required actions. Plugin disposal removes the feedback and clears the retained transfer. Loader-backed browser scenarios cover the shipped composition, while focused tests exercise cross-root delivery and late failure feedback.
