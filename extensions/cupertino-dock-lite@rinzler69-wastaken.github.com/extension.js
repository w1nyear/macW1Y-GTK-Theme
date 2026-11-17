/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */


import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Animator } from './animator.js';

export default class DashAnimatorExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._applySettings();
    this._settings.connectObject('changed', () => this._applySettings(), this);

    this.animator = new Animator();
    this.animator.extension = this;

    if (!this._findDashContainer()) {
      this._findDashIntervalId = setInterval(() => {
        if (this._findDashContainer()) {
          clearInterval(this._findDashIntervalId);
          this._findDashIntervalId = null;
        }
      }, 500);
    }

    global.display.connectObject(
      'in-fullscreen-changed', () => this._onFullScreen(),
      this
    );

    this.animator.enable();
    this._connectThemeSettings();
    this._initWaylandDndBridge();

    if (!this._dndMonitor) {
      this._dndMonitor = {
        dragMotion: (dropInfo) => {
          if (dropInfo.dragActor) {
            dropInfo.dragActor._isDndDragActor = true;
            globalThis._activeDndDragActor = dropInfo.dragActor;
          }

          if (!this._dragging && dropInfo.source && this._isFromDash(dropInfo.source)) {
            this._dragging = true;
            const app = this._getDraggedApp(dropInfo.source);
            this._draggedAppId = app?.get_id?.();
            this._draggedSourceActor = dropInfo.dragActor;
            this._hideDraggedSourceActor();
            if (this.animator) {
              this.animator._pauseForDrag();
            }
          }

          if (this._isPointerOverDock(35)) {
            if (this.animator && this.animator._iconsContainer) {
              this.animator._pauseForDrag();
            }
          } else {
            if (this._customPlaceholder) {
              this._clearCustomPlaceholder(true);
            }
          }
          return DND.DragMotionResult.CONTINUE;
        },
        dragDrop: (dropInfo) => {
          if (this._dragging && this._draggedAppId) {
            const isOutside = !this._isPointerOverDock(40);
            if (isOutside && !this._isPointerOverTrash()) {
              const appId = this._draggedAppId;
              const favs = AppFavorites.getAppFavorites();
              if (appId !== 'launchpad.desktop' && favs.isFavorite(appId)) {
                favs.removeFavorite(appId);
                try {
                  global.display.get_sound_player().play_from_theme('trash-empty', 'Unpin', null);
                } catch (_) {}
              }


              const actor = dropInfo.dropActor || this._draggedSourceActor;
              if (actor && actor.get_stage()) {
                try {
                  actor.remove_all_transitions();
                  actor.ease({
                    opacity: 0,
                    scale_x: 1.4,
                    scale_y: 1.4,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                      try { actor.destroy(); } catch (_) {}
                    }
                  });
                } catch (_) {}
              }

              this._cleanUpDragState();
              return DND.DragDropResult.SUCCESS;
            }
          }
          return DND.DragMotionResult.CONTINUE;
        }
      };
      DND.addDragMonitor(this._dndMonitor);
    }
  }

  disable() {
    this._cleanUpDragState();
    if (this._dndMonitor) {
      DND.removeDragMonitor(this._dndMonitor);
      this._dndMonitor = null;
    }
    if (globalThis._activeDndDragActor) {
      globalThis._activeDndDragActor = null;
    }
    Main.xdndHandler.disconnectObject(this);
    this._disconnectThemeSettings();
    if (this.animator) this.animator.disable();

    if (this._findDashIntervalId) {
      clearInterval(this._findDashIntervalId);
      this._findDashIntervalId = null;
    }

    if (this._oneShotId) {
      clearTimeout(this._oneShotId);
      this._oneShotId = null;
    }

    this._pendingHide = null;

    this._disconnectIconEvents();

    global.display.disconnectObject(this);

    if (this.dashContainer) {
      if (this.dashContainer.__animateIn)
        this.dashContainer._animateIn = this.dashContainer.__animateIn;
      if (this.dashContainer.__animateOut)
        this.dashContainer._animateOut = this.dashContainer.__animateOut;
      this.dashContainer.set_reactive(false);
      this.dashContainer.set_track_hover(false);
      this._disconnectDashContainerEvents();
    }

    if (this.dash) {
      this._unpatchTrashUnpinDrop();
      this._disconnectDashEvents();
      this.dash = null;
    }

    this.dashContainer = null;
    this.animator = null;

    if (this._settings) {
      this._settings.disconnectObject(this);
      this._settings = null;
    }
  }

  _disconnectIconEvents() {
    this._findIcons().forEach(c => {
      const appIcon = c._appwell?.child?._delegate;
      if (appIcon) {
        appIcon.disconnectObject(this);
        appIcon._dashAnimatorUrgentHooked = false;
      }
    });
    if (this.dash?.showAppsButton) {
      this.dash.showAppsButton.disconnectObject(this);
      this.dash.showAppsButton._dashAnimatorHooked = false;
    }
  }

  _disconnectDashEvents() {
    if (this.dash) {
      this.dash.disconnectObject(this);
      if (this.dash._box) {
        this.dash._box.disconnectObject(this);
      }
    }
  }

  _disconnectDashContainerEvents() {
    if (this.dashContainer) {
      this.dashContainer.disconnectObject(this);
    }
  }

  _applySettings() {
    this.urgent_bounce = this._settings.get_boolean('urgent-bounce');
  }

  _findChildByName(actor, name, maxDepth = 4, currentDepth = 0) {
    if (!actor) return null;
    if (actor.name === name) return actor;
    if (currentDepth >= maxDepth) return null;

    const children = actor.get_children();
    for (let i = 0; i < children.length; i++) {
      const found = this._findChildByName(children[i], name, maxDepth, currentDepth + 1);
      if (found) return found;
    }
    return null;
  }

  _findDashContainer() {
    if (this.dashContainer) {
      return false;
    }

    this.dashContainer = this._findChildByName(Main.uiGroup, 'dashtodockContainer');
    if (!this.dashContainer) {
      return false;
    }

    if (this._findDashIntervalId) {
      clearInterval(this._findDashIntervalId);
      this._findDashIntervalId = null;
    }

    this.scale = 1;
    this.dashContainer.delegate = this;
    this.animator.dashContainer = this.dashContainer;

    this._disconnectDashEvents();
    this._disconnectIconEvents();
    this.dash = this._findChildByName(this.dashContainer, 'dash');
    this._patchTrashUnpinDrop();
    if (this.dash) {
      this.dashContainer._delegate = this.dash;
      this.dashContainer.handleDragOver = (...args) => this.dash?.handleDragOver?.(...args);
      this.dashContainer.acceptDrop = (...args) => this.dash?.acceptDrop?.(...args);
    }
    this._iconsDirty = true;

    this.dash._box.connectObject(
      'child-added', () => { this._iconsDirty = true; this._startAnimation(); },
      'child-removed', () => { this._iconsDirty = true; this._startAnimation(); },
      this
    );
    this.dash.connectObject(
      'icon-size-changed', () => {
        this._iconsDirty = true;
        this._startAnimation();
      },
      this
    );

    this.dashContainer.set_reactive(true);
    this.dashContainer.set_track_hover(true);

    this.dashContainer.connectObject('destroy', () => {
      this._iconsDirty = true;
      this._disconnectDashEvents();
      this._disconnectIconEvents();
      this.dash = null;
      if (!this.animator) return;
      this.animator.disable();
      this.animator.dashContainer = null;
      this.animator.enable();
      this.dashContainer = null;
      if (!this._findDashIntervalId) {
        this._findDashIntervalId = setInterval(
          this._findDashContainer.bind(this),
          500
        );
      }
    }, this);


    this.dashContainer.__animateIn = this.dashContainer._animateIn;
    this.dashContainer.__animateOut = this.dashContainer._animateOut;

    this.dashContainer._animateIn = (time, delay) => {

      this._pendingHide = null;
      this._isHidden = false;

      if (this.animator) this.animator.resumeUrgentBounce();
      this._startAnimation();
      this.dashContainer.__animateIn(time, delay);
    };
    this.dashContainer._animateOut = (time, delay) => {




      const anyJumping = this.animator?.isJumping();
      const anyFirstRunPending = this._iconsContainer_firstRunPending();
      if (anyJumping || anyFirstRunPending) {
        this._pendingHide = { time, delay };
        this.dashContainer.__animateIn(0.2, 0);
        return;
      }
      this._isHidden = true;
      this._pendingHide = null;
      this.dashContainer.__animateOut(time, delay);
    };

    this._startAnimation();
    return true;
  }

  _findIcons() {
    if (!this.dash || !this.dashContainer) return [];

    if (!this._iconsDirty && this.dashContainer._icons) {
      return this.dashContainer._icons;
    }
    this._iconsDirty = false;

    const dashChildren = this.dash._box.get_children();


    if (this.dash.showAppsButton && !this.dash.showAppsButton._dashAnimatorHooked) {
      this.dash.showAppsButton._dashAnimatorHooked = true;
      this.dash.showAppsButton.connectObject(
        'notify::checked',
        () => {
          if (!Main.overview.visible) {
            this._findChildByName(Main.uiGroup, 'overview')
              ?._controls?._toggleAppsPage();
          }
        },
        this
      );
    }

    const icons = dashChildren.filter((actor) => {
      if (actor.child && actor.child._delegate && actor.child._delegate.icon) {
        return true;
      }
      return false;
    });

    icons.forEach((c) => {
      const appwell = c.first_child;
      if (c._appwell === appwell) {
        if (c._bin?.get_parent()?.clip_to_view) {
          c._bin.get_parent().clip_to_view = false;
        }
        return;
      }

      const widget = appwell.first_child;
      const icongrid = widget.first_child;
      const boxlayout = icongrid.first_child;
      const bin = boxlayout.first_child;
      if (!bin) return;
      const icon = bin.first_child;

      if (boxlayout && boxlayout.clip_to_view !== false) {
        boxlayout.clip_to_view = false;
      }

      c._bin = bin;
      c._label = c.label;
      c._draggable = appwell._draggable;
      c._appwell = appwell;
      if (icon) {
        c._icon = icon;
      }


      const appIcon = appwell.child && appwell.child._delegate;
      if (appIcon && !appIcon._dashAnimatorUrgentHooked) {
        appIcon._dashAnimatorUrgentHooked = true;
        appIcon.connectObject('notify::urgent', () => {
          if (this.urgent_bounce && appIcon.urgent) {
            if (this.animator) this.animator.requestUrgentBounce(appwell, true);
            if (this.dashContainer && this.dashContainer._animateIn)
              this.dashContainer._animateIn(0.2, 0);
          } else {
            if (this.animator) this.animator.clearUrgentBounce(appwell);
          }
        }, this);
      }
    });

    const apps = Main.overview.dash?.last_child?.last_child;
    if (apps) {
      const widget = apps.child;

      if (widget && widget.width > 0 && widget.get_parent()?.visible) {
        const icongrid = widget.first_child;
        const boxlayout = icongrid.first_child;
        const bin = boxlayout.first_child;
        const icon = bin.first_child;
        if (boxlayout && boxlayout.clip_to_view !== false) {
          boxlayout.clip_to_view = false;
        }
        const c = {
          child: widget,
          _bin: bin,
          _icon: icon,
          _label: widget._delegate?.label,
          _appwell: widget,
        };
        icons.push(c);
      }
    }

    this.dashContainer._icons = icons;
    return icons;
  }

  _isFromDash(source) {
    if (!source) return false;
    if (this._draggedSourceActor && (source === this._draggedSourceActor || source === this._draggedSourceActor._delegate)) {
      return true;
    }
    if (this._dragging && this._draggedContainer) {
      const app = this._getDraggedApp(source);
      if (app && app.get_id?.() === this._draggedAppId) {
        return true;
      }
    }
    const actor = source?.actor ?? source?.child ?? source;
    if (actor && typeof actor.get_parent === 'function') {
      if (this.dash?._box?.contains(actor) || this.dashContainer?.contains(actor)) {
        return true;
      }
    }
    return false;
  }

  _onDragBegin(draggable) {
    this._dragging = true;
    const app = draggable.actor?._delegate?.app ?? draggable.actor?.app;
    const appId = app?.get_id?.();
    this._draggedAppId = appId;
    this._draggedSourceActor = draggable.actor;

    let container = draggable.actor?.get_parent?.();
    while (container && container.get_parent() !== this.dash?._box) {
      container = container.get_parent();
    }
    if (container && container.get_parent() === this.dash?._box) {
      this._draggedContainer = container;
    } else if (appId && this.dash?._box) {
      for (const child of this.dash._box.get_children()) {
        const id = child.child?._delegate?.app?.get_id?.() ?? child.child?.app?.get_id?.();
        if (id === appId) {
          this._draggedContainer = child;
          break;
        }
      }
    }
  }

  _hideDraggedSourceActor() {
    if (this._draggedContainer) {
      this._draggedContainer.visible = false;
      this._draggedContainer.opacity = 0;
    }
    if (this._draggedSourceActor) {
      this._draggedSourceActor.opacity = 0;
    }
  }

  _showCustomPlaceholder(targetPos, width, height) {
    if (!this.dash?._box) return;

    const children = this.dash._box.get_children();
    const favs = AppFavorites.getAppFavorites().getFavorites();
    const favIds = favs.map(a => a.get_id());
    const visibleFavs = [];
    for (const child of children) {
      if (child === this._customPlaceholder) continue;
      if (child === this._draggedContainer) continue;
      const childAppId = child.child?._delegate?.app?.get_id?.() ?? child.child?.app?.get_id?.();
      if (childAppId && favIds.includes(childAppId)) {
        visibleFavs.push(child);
      }
    }

    const placeholderWidth = width || visibleFavs[0]?.width || (this.dash.iconSize + 8) || 62;
    const placeholderHeight = height || visibleFavs[0]?.height || this.dash.iconSize || 62;

    if (!this._customPlaceholder) {
      this._customPlaceholder = new St.Bin({
        name: 'cupertinoDragPlaceholder',
        width: placeholderWidth,
        height: placeholderHeight,
        reactive: false,
        can_focus: false,
        opacity: 0,
      });
      this._customPlaceholder._isDndDragActor = true;

      if (targetPos < visibleFavs.length) {
        this.dash._box.insert_child_below(this._customPlaceholder, visibleFavs[targetPos]);
      } else if (visibleFavs.length > 0) {
        this.dash._box.insert_child_above(this._customPlaceholder, visibleFavs[visibleFavs.length - 1]);
      } else {
        this.dash._box.insert_child_at_index(this._customPlaceholder, 0);
      }


      if (this.dash._separator && this.dash._separator.get_parent() === this.dash._box) {
        const lastFav = visibleFavs[visibleFavs.length - 1];
        const refChild = (targetPos >= visibleFavs.length) ? this._customPlaceholder : lastFav;
        if (refChild) {
          this.dash._box.set_child_above_sibling(this.dash._separator, refChild);
        }
      }

      this._customPlaceholderPos = targetPos;


      for (let i = targetPos; i < visibleFavs.length; i++) {
        const item = visibleFavs[i];
        item.remove_transition('translation_x');
        item.translation_x = -placeholderWidth;
        item.ease({
          translation_x: 0,
          duration: 200,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
      }

      if (this.dash._separator) {
        this.dash._separator.remove_transition('translation_x');
        this.dash._separator.translation_x = -placeholderWidth;
        this.dash._separator.ease({
          translation_x: 0,
          duration: 200,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
      }
      return;
    }

    if (this._customPlaceholderPos !== targetPos) {
      const prevPos = this._customPlaceholderPos;
      this._customPlaceholderPos = targetPos;


      if (targetPos < visibleFavs.length) {
        this.dash._box.set_child_below_sibling(this._customPlaceholder, visibleFavs[targetPos]);
      } else if (visibleFavs.length > 0) {
        this.dash._box.set_child_above_sibling(this._customPlaceholder, visibleFavs[visibleFavs.length - 1]);
      }


      if (this.dash._separator && this.dash._separator.get_parent() === this.dash._box) {
        const lastFav = visibleFavs[visibleFavs.length - 1];
        const refChild = (targetPos >= visibleFavs.length) ? this._customPlaceholder : lastFav;
        if (refChild) {
          this.dash._box.set_child_above_sibling(this.dash._separator, refChild);
        }
      }


      if (targetPos > prevPos) {

        for (let i = prevPos; i < targetPos && i < visibleFavs.length; i++) {
          const item = visibleFavs[i];
          const curTrans = item.translation_x || 0;
          item.remove_transition('translation_x');
          item.translation_x = curTrans + placeholderWidth;
          item.ease({
            translation_x: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          });
        }
      } else {

        for (let i = targetPos; i < prevPos && i < visibleFavs.length; i++) {
          const item = visibleFavs[i];
          const curTrans = item.translation_x || 0;
          item.remove_transition('translation_x');
          item.translation_x = curTrans - placeholderWidth;
          item.ease({
            translation_x: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          });
        }
      }
    }
  }

  _clearCustomPlaceholder(animate = false) {
    if (this._customPlaceholder) {
      const p = this._customPlaceholder;
      const pos = this._customPlaceholderPos;
      this._customPlaceholder = null;
      this._customPlaceholderPos = -1;

      if (!animate) {
        try {
          p.get_parent()?.remove_child(p);
          p.destroy();
        } catch (_) {}
        if (this.dash?._box) {
          for (const child of this.dash._box.get_children()) {
            child.remove_transition('translation_x');
            child.translation_x = 0;
          }
        }
        return;
      }

      const width = p.width || (this.dash?.iconSize + 8) || 62;
      const favs = AppFavorites.getAppFavorites().getFavorites();
      const favIds = favs.map(a => a.get_id());
      const visibleFavs = [];
      if (this.dash?._box) {
        for (const child of this.dash._box.get_children()) {
          if (child === p) continue;
          if (this._dragging && child === this._draggedContainer) continue;
          const childAppId = child.child?._delegate?.app?.get_id?.() ?? child.child?.app?.get_id?.();
          if (childAppId && favIds.includes(childAppId)) {
            visibleFavs.push(child);
          }
        }
      }

      try {
        p.get_parent()?.remove_child(p);
        p.destroy();
      } catch (_) {}

      if (pos >= 0) {
        for (let i = pos; i < visibleFavs.length; i++) {
          const item = visibleFavs[i];
          const curTrans = item.translation_x || 0;
          item.remove_transition('translation_x');
          item.translation_x = curTrans + width;
          item.ease({
            translation_x: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          });
        }
        if (this.dash?._separator) {
          const curTrans = this.dash._separator.translation_x || 0;
          this.dash._separator.remove_transition('translation_x');
          this.dash._separator.translation_x = curTrans + width;
          this.dash._separator.ease({
            translation_x: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          });
        }
      }
    } else {
      this._customPlaceholderPos = -1;
    }
  }

  _cleanUpDragState() {
    this._dragging = false;
    this._clearCustomPlaceholder(false);
    if (this._draggedContainer) {
      if (this._draggedAppId && AppFavorites.getAppFavorites().isFavorite(this._draggedAppId)) {
        this._draggedContainer.visible = true;
        this._draggedContainer.opacity = 255;
        if (this._draggedContainer.child) {
          this._draggedContainer.child.opacity = 255;
        }
      }
      this._draggedContainer = null;
    }
    if (this._draggedSourceActor) {
      this._draggedSourceActor.opacity = 255;
      this._draggedSourceActor = null;
    }
    this._draggedAppId = null;
    if (this.animator && !this.animator._iconsContainer) {
      if (this.animator._oneShotId) {
        clearTimeout(this.animator._oneShotId);
      }
      this.animator._oneShotId = setTimeout(() => {
        this.animator._oneShotId = null;
        if (this.animator) {
          this.animator.enable();
          this._iconsDirty = true;
          this.animator._startAnimation();
        }
      }, 300);
    }
  }

  _patchTrashUnpinDrop() {
    if (!this.dash || this.dash._cupertinoTrashUnpinPatched) return;

    this.dash._cupertinoTrashUnpinPatched = {
      handleDragOver: this.dash.handleDragOver,
      acceptDrop: this.dash.acceptDrop,
    };

    this.dash.handleDragOver = (source, actor, x, y, time) => {

      if (this._isPointerOverTrash()) {
        this._clearCustomPlaceholder(true);
        const app = this._getDraggedApp(source);
        if (app && app.get_id && !app.isTrash) {
          return DND.DragMotionResult.MOVE_DROP;
        }
        if (this._isExternalDrag(source)) {
          return DND.DragMotionResult.MOVE_DROP;
        }
        return DND.DragMotionResult.NO_DROP;
      }


      if (this.animator && this.animator._iconsContainer) {
        this.animator._pauseForDrag();
      }

      let app = this._getDraggedApp(source);
      let appId = app?.get_id?.() ?? this._draggedAppId;
      const isExternal = this._isExternalDrag(source);

      if (!appId && isExternal) {
        if (this._activeDndUris?.length > 0) {
          appId = this._resolveAppIdFromUri(this._activeDndUris[0]);
          if (appId) {
            app = Shell.AppSystem.get_default().lookup_app(appId);
          }
        } else {
          this._readDndUris().then(uris => {
            this._activeDndUris = uris;
          });
        }
      }

      const isFromDash = this._isFromDash(source);


      if (isFromDash) {
        this._hideDraggedSourceActor();
      }


      const favs = AppFavorites.getAppFavorites().getFavorites();
      const favIds = favs.map(a => a.get_id());
      const children = this.dash._box.get_children();
      const visibleFavs = [];
      for (const child of children) {
        if (child === this._customPlaceholder) continue;
        if (isFromDash && child === this._draggedContainer) continue;
        const childAppId = child.child?._delegate?.app?.get_id?.() ?? child.child?.app?.get_id?.();
        if (childAppId && favIds.includes(childAppId)) {
          visibleFavs.push(child);
        }
      }


      const [pointerX, pointerY] = global.get_pointer();
      const [_, boxX] = this.dash._box.transform_stage_point(pointerX, pointerY);

      let targetPos = visibleFavs.length;
      for (let i = 0; i < visibleFavs.length; i++) {
        const c = visibleFavs[i];
        const midX = c.x + c.width / 2;
        if (boxX < midX) {
          targetPos = i;
          break;
        }
      }

      const sampleWidth = visibleFavs[0]?.width || (this.dash.iconSize + 8);
      const sampleHeight = visibleFavs[0]?.height || this.dash.iconSize;
      this._showCustomPlaceholder(targetPos, sampleWidth, sampleHeight);

      return isFromDash ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.COPY_DROP;
    };

    this.dash.acceptDrop = (source, actor, x, y, time) => {

      if (this._isPointerOverTrash()) {
        const app = this._getDraggedApp(source);
        if (app && app.get_id && !app.isTrash) {
          const appId = app.get_id();
          this._cleanUpDragState();
          if (AppFavorites.getAppFavorites().isFavorite(appId)) {
            AppFavorites.getAppFavorites().removeFavorite(appId);
          }
          let desktopPath = `${GLib.get_user_data_dir()}/applications/${appId}`;
          let f = Gio.File.new_for_path(desktopPath);
          if (f.query_exists(null)) {
            try {
              f.trash(null);
            } catch (e) {
              logError(e, 'Failed to trash app: ' + appId);
            }
          }
          try {
            global.display.get_sound_player().play_from_theme('trash-empty', 'Trash', null);
          } catch (_) {}
          return true;
        }
        return false;
      }

      let app = this._getDraggedApp(source);
      let appId = app?.get_id?.() ?? this._draggedAppId;
      const isExternal = this._isExternalDrag(source);

      if (!appId && isExternal && this._activeDndUris?.length > 0) {
        appId = this._resolveAppIdFromUri(this._activeDndUris[0]);
      }

      const isFromDash = this._isFromDash(source);
      const targetPos = this._customPlaceholderPos >= 0 ? this._customPlaceholderPos : AppFavorites.getAppFavorites().getFavorites().length;

      this._clearCustomPlaceholder(false);
      this._cleanUpDragState();

      if (appId && targetPos >= 0) {
        const appFavs = AppFavorites.getAppFavorites();
        if (isFromDash) {
          appFavs.moveFavoriteToPos(appId, targetPos);
        } else {
          if (appFavs.isFavorite(appId)) {
            appFavs.moveFavoriteToPos(appId, targetPos);
          } else {
            appFavs.addFavoriteAtPos(appId, targetPos);
          }
        }
        try {
          global.display.get_sound_player().play_from_theme('dialog-information', 'Drop', null);
        } catch (_) {}
        return true;
      }

      return false;
    };
  }

  _unpatchTrashUnpinDrop() {
    this._cleanUpDragState();
    if (!this.dash?._cupertinoTrashUnpinPatched) return;

    const patch = this.dash._cupertinoTrashUnpinPatched;
    this.dash.handleDragOver = patch.handleDragOver;
    this.dash.acceptDrop = patch.acceptDrop;
    this.dash._cupertinoTrashUnpinPatched = null;
  }

  _initWaylandDndBridge() {
    this._activeDndUris = [];
    Main.xdndHandler.connectObject(
      'drag-begin', () => {
        this._activeDndUris = [];
        this._readDndUris().then(uris => {
          this._activeDndUris = uris;
        });
      },
      'drag-end', () => {
        const uris = this._activeDndUris || [];
        this._activeDndUris = [];
        if (uris.length === 0) return;


        if (this._isPointerOverTrash()) {
          for (const uri of uris) {
            try {
              const f = Gio.File.new_for_uri(uri);
              f.trash(null);
            } catch (e) {
              logError(e, 'Failed to trash DND uri: ' + uri);
            }
          }
          try {
            global.display.get_sound_player().play_from_theme('trash-empty', 'Trash', null);
          } catch (_) {}
          return;
        }


        if (this._isPointerOverDock(35)) {
          const targetPos = this._customPlaceholderPos;
          this._cleanUpDragState();
          for (const uri of uris) {
            const appId = this._resolveAppIdFromUri(uri);
            if (appId) {
              const favs = AppFavorites.getAppFavorites();
              if (favs.isFavorite(appId)) {
                if (targetPos >= 0) {
                  favs.moveFavoriteToPos(appId, targetPos);
                }
              } else {
                if (targetPos >= 0) {
                  favs.addFavoriteAtPos(appId, targetPos);
                } else {
                  favs.addFavorite(appId);
                }
                try {
                  global.display.get_sound_player().play_from_theme('dialog-information', 'Pin', null);
                } catch (_) {}
              }
            }
          }
        }
      },
      this
    );
  }

  _readDndUris() {
    return new Promise(resolve => {
      try {
        const sel = global.display.get_selection();
        const mimes = sel.get_mimetypes(Meta.SelectionType.SELECTION_DND);
        if (!mimes.includes('text/uri-list')) {
          resolve([]);
          return;
        }
        const stream = Gio.MemoryOutputStream.new_resizable();
        sel.transfer_async(Meta.SelectionType.SELECTION_DND, 'text/uri-list', -1, stream, null, (_obj, res) => {
          try {
            const success = sel.transfer_finish(res);
            if (success) {
              stream.close(null);
              const bytes = stream.steal_as_bytes();
              const text = new TextDecoder().decode(bytes.get_data());
              const uris = text.split(/[\r\n]+/).map(u => u.trim()).filter(u => u.length > 0 && !u.startsWith('#'));
              resolve(uris);
              return;
            }
          } catch (_) {}
          resolve([]);
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  _resolveAppIdFromUri(uri) {
    try {
      const file = Gio.File.new_for_uri(uri);
      const path = file.get_path();
      if (!path) return null;
      if (path.endsWith('.desktop')) {
        let realAppId = null;
        try {
          const [ok, content] = GLib.file_get_contents(path);
          if (ok) {
            const lines = new TextDecoder().decode(content).split('\n');
            for (const l of lines) {
              if (l.startsWith('X-Mac-Real-Path=')) {
                const realPath = l.split('=')[1].trim();
                realAppId = GLib.path_get_basename(realPath);
                break;
              }
            }
          }
        } catch (_) {}
        if (!realAppId) {
          realAppId = GLib.path_get_basename(path);
        }
        const app = Shell.AppSystem.get_default().lookup_app(realAppId) ??
                    Shell.AppSystem.get_default().lookup_app(GLib.path_get_basename(path));
        return app ? app.get_id() : realAppId;
      } else {
        const base = GLib.path_get_basename(path);
        const app = Shell.AppSystem.get_default().lookup_app(`${base}.desktop`) ??
                    Shell.AppSystem.get_default().lookup_app(base);
        if (app) return app.get_id();
      }
    } catch (_) {}
    return null;
  }

  _isPointerOverDock(margin = 25) {
    if (!this.dashContainer) return false;
    const [pointerX, pointerY] = global.get_pointer();
    const [dockX, dockY] = this.dashContainer.get_transformed_position();
    const [dockWidth, dockHeight] = this.dashContainer.get_transformed_size();
    return pointerX >= (dockX - margin) && pointerX <= (dockX + dockWidth + margin) &&
           pointerY >= (dockY - margin) && pointerY <= (dockY + dockHeight + margin);
  }

  _isExternalDrag(source) {
    return !source || source === Main.xdndHandler || source.constructor?.name === 'XdndHandler';
  }

  _canUnpinDraggedFavoriteOnTrash(source) {
    const app = this._getDraggedApp(source);
    if (!app?.get_id || app.isTrash) return false;

    const appId = app.get_id();
    return global.settings.is_writable('favorite-apps') &&
      AppFavorites.getAppFavorites().isFavorite(appId);
  }

  _getDraggedApp(source) {
    return source?.app ?? source?._delegate?.app ?? source?.child?._delegate?.app ?? null;
  }

  _isPointerOverTrash() {
    const trashActor = this._getTrashActor();
    if (!trashActor) return false;

    const [pointerX, pointerY] = global.get_pointer();
    const [trashX, trashY] = trashActor.get_transformed_position();
    const [trashWidth, trashHeight] = trashActor.get_transformed_size();

    return pointerX >= trashX &&
      pointerX <= trashX + trashWidth &&
      pointerY >= trashY &&
      pointerY <= trashY + trashHeight;
  }

  _getTrashActor() {
    const children = this.dash?._box ? this.dash._box.get_children() : [];
    return children.find(actor => actor.child?._delegate?.app?.isTrash) ?? null;
  }

  _beginAnimation() {
    if (this.animator)
      this.animator._beginAnimation();
  }

  _endAnimation() {
    if (this.animator)
      this.animator._endAnimation();
  }

  _onFullScreen() {

    const isFullscreen = global.display.get_monitor_in_fullscreen(
      global.display.get_current_monitor()
    );
    if (isFullscreen) {
      if (this.dashContainer && this.dashContainer._animateOut)
        this.dashContainer._animateOut(0.1, 0);
    } else {

      if (this.dashContainer && this.dashContainer._animateIn)
        this.dashContainer._animateIn(0.3, 0.1);
    }
  }

  _startAnimation() {
    if (this.animator)
      this.animator._startAnimation();
  }



  _iconsContainer_firstRunPending() {
    if (!this.animator?._iconsContainer) return false;
    return this.animator._iconsContainer.get_children()
      .filter(c => c.name !== 'cupertinisator-badge')
      .some(c => (c._appwell?._dashAnimatorUrgentFirstRunRemaining ?? 0) > 0);
  }



  _firePendingHide() {
    if (!this._pendingHide) return;
    const { time, delay } = this._pendingHide;
    this._pendingHide = null;
    this._isHidden = true;
    if (this.dashContainer?.__animateOut)
      this.dashContainer.__animateOut(time, delay);
  }


  _applyThemeOverride() {
    if (this._themeApplyTimeoutId) {
      GLib.source_remove(this._themeApplyTimeoutId);
      this._themeApplyTimeoutId = null;
    }
    if (this._themeInTimeoutId) {
      GLib.source_remove(this._themeInTimeoutId);
      this._themeInTimeoutId = null;
    }

    if (!this._settings.get_boolean('override-theming')) {
      this._removeThemeOverride();
      if (this.animator) this.animator.reloadIcons();
      return;
    }

    const theme = this._settings.get_string('dock-theme');
    const aware = this._settings.get_boolean('theme-aware');
    let scheme;

    if (aware) {
      scheme = this._desktopSettings.get_string('color-scheme') === 'prefer-dark' ? 'dark' : 'light';
    } else {
      scheme = this._settings.get_string('dock-color-scheme');
    }

    const fileName = `${theme}-${scheme}.css`;
    const cssFile = Gio.File.new_for_path(`${this.path}/themes/${fileName}`);

    cssFile.query_info_async(
      Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      null,
      (file, res) => {
        try {
          file.query_info_finish(res);
        } catch (e) {
          return;
        }

        const applyThemeNow = () => {
          this._removeThemeOverride();

          if (!this.animator) return;

          const themeContext = St.ThemeContext.get_for_stage(global.stage);
          const stTheme = themeContext.get_theme();
          stTheme.load_stylesheet(cssFile);
          this._loadedThemeFile = cssFile;

          themeContext.emit('changed');
          if (this.animator) this.animator.reloadIcons();



          this._themeInTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._themeInTimeoutId = null;
            if (this.dashContainer && this.dashContainer._animateIn)
              this.dashContainer._animateIn(0.2, 0);
            return GLib.SOURCE_REMOVE;
          });
        };


        if (this.dashContainer && this.dashContainer.__animateOut) {
          this.dashContainer.__animateOut(0.2, 0);
          this._themeApplyTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._themeApplyTimeoutId = null;
            applyThemeNow();
            return GLib.SOURCE_REMOVE;
          });
        } else {
          applyThemeNow();
        }
      }
    );
  }

  _removeThemeOverride() {
    if (this._loadedThemeFile) {
      try {
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.get_theme().unload_stylesheet(this._loadedThemeFile);
      } catch (e) { }
      this._loadedThemeFile = null;
    }
  }

  _connectThemeSettings() {
    const s = this._settings;


    s.connectObject(
      'changed::override-theming', () => this._applyThemeOverride(),
      'changed::dock-theme', () => this._applyThemeOverride(),
      'changed::theme-aware', () => this._applyThemeOverride(),
      'changed::dock-color-scheme', () => this._applyThemeOverride(),
      this
    );


    this._desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    this._desktopSettings.connectObject('changed::color-scheme', () => this._applyThemeOverride(), this);

    this._applyThemeOverride();
  }

  _disconnectThemeSettings() {
    if (this._themeApplyTimeoutId) {
      GLib.source_remove(this._themeApplyTimeoutId);
      this._themeApplyTimeoutId = null;
    }
    if (this._themeInTimeoutId) {
      GLib.source_remove(this._themeInTimeoutId);
      this._themeInTimeoutId = null;
    }
    this._settings.disconnectObject(this);
    if (this._desktopSettings) {
      this._desktopSettings.disconnectObject(this);
      this._desktopSettings = null;
    }
    this._removeThemeOverride();
  }

}
