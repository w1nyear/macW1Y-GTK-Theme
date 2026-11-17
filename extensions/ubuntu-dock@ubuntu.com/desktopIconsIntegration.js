/*
 * The code in this file is distributed under a "1-clause BSD license",
 * which makes it compatible with GPLv2 and GPLv3 too, and others.
 *
 * License text:
 *
 * Copyright (C) 2021 Sergio Costas (rastersoft@gmail.com)
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 * this list of conditions and the following disclaimer.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */































import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ExtensionUtils from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const IDENTIFIER_UUID = '130cbc66-235c-4bd6-8571-98d2d8bba5e2';

export class DesktopIconsUsableAreaClass {
    _checkIfExtensionIsEnabled(extension) {
        return (extension?.state === ExtensionUtils.ExtensionState.ENABLED) ||
               (extension?.state === ExtensionUtils.ExtensionState.ACTIVE);
    }

    constructor(extension) {
        this._UUID = extension.uuid;
        this._extensionManager = Main.extensionManager;
        this._timedMarginsID = 0;
        this._margins = {};
        this._emID = this._extensionManager.connect('extension-state-changed', (_obj, ext) => {
            if (!ext)
                return;



            if (this._checkIfExtensionIsEnabled(ext)) {
                this._sendMarginsToExtension(ext);
                return;
            }




            this._changedMargins();
        });
    }













    setMargins(monitor, top, bottom, left, right) {
        this._margins[monitor] = {
            top,
            bottom,
            left,
            right,
        };
        this._changedMargins();
    }





    resetMargins() {
        this._margins = {};
        this._changedMargins();
    }




    destroy() {
        if (this._emID) {
            this._extensionManager.disconnect(this._emID);
            this._emID = 0;
        }
        if (this._timedMarginsID) {
            GLib.source_remove(this._timedMarginsID);
            this._timedMarginsID = 0;
        }
        this._margins = null;
        this._changedMargins();
    }

    _changedMargins() {
        if (this._timedMarginsID)
            GLib.source_remove(this._timedMarginsID);

        this._timedMarginsID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._sendMarginsToAll();
            this._timedMarginsID = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _sendMarginsToAll() {
        this._extensionManager.getUuids().forEach(uuid =>
            this._sendMarginsToExtension(this._extensionManager.lookup(uuid)));
    }

    _sendMarginsToExtension(extension) {


        if (!this._checkIfExtensionIsEnabled(extension))
            return;

        const usableArea = extension?.stateObj?.DesktopIconsUsableArea;
        if (usableArea?.uuid === IDENTIFIER_UUID) {
            usableArea.setMarginsForExtension(
                this._UUID, this._margins);
        }
    }
}
