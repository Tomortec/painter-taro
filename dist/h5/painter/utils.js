import { toPx } from 'painter-kernel';
import { equal } from './lib/util';
const ACTION_DEFAULT_SIZE = 24;
const ACTION_OFFSET = '2rpx';
/**
 * 判断一个 object 是否为 空
 * @param {object} object
 */
export function isEmpty(object) {
  for (const _i in object) {
    return false;
  }
  return true;
}
export function isInView(x, y, rect) {
  return x > rect.left && y > rect.top && x < rect.right && y < rect.bottom;
}
export function isInDelete(x, y, block) {
  if (block) {
    for (const view of block.views) {
      if (view.id === 'delete') {
        return isInView(x, y, view.rect);
      }
    }
  }
  return false;
}
export function isInScale(x, y, block) {
  if (block) {
    for (const view of block.views) {
      if (view.id === 'scale') {
        return isInView(x, y, view.rect);
      }
    }
  }
  return false;
}
export function isNeedRefresh(newVal, oldVal, dirty) {
  if (!newVal || isEmpty(newVal) || dirty && equal(newVal, oldVal)) {
    return false;
  }
  return true;
}
export function getBox(rect, type, customActionStyle) {
  const boxArea = {
    id: 'box',
    type: 'rect',
    css: {
      height: `${rect.bottom - rect.top}px`,
      width: `${rect.right - rect.left}px`,
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      borderWidth: '4rpx',
      borderColor: '#1A7AF8',
      color: 'transparent'
    }
  };
  if (type === 'text') {
    boxArea.css = Object.assign({}, boxArea.css, {
      borderStyle: 'dashed'
    });
  }
  if (customActionStyle && customActionStyle.border) {
    boxArea.css = Object.assign({}, boxArea.css, customActionStyle.border);
  }
  return boxArea;
}
export function getScaleIcon(rect, type, customActionStyle) {
  const scaleArea = {
    id: 'scale',
    type: 'rect',
    css: {
      color: '#0000ff'
    }
  };
  if (customActionStyle && customActionStyle.scale) {
    Object.assign(scaleArea, {
      type: 'image',
      url: type === 'text' ? customActionStyle.scale.textIcon : customActionStyle.scale.imageIcon,
      css: {}
    });
  }
  const actionOffset = toPx(ACTION_OFFSET);
  const commonLength = `${48}rpx`;
  scaleArea.css = Object.assign({}, scaleArea.css, {
    align: 'center',
    height: commonLength,
    width: commonLength,
    borderRadius: `${ACTION_DEFAULT_SIZE}rpx`,
    left: `${rect.right + actionOffset}px`,
    top: type === 'text' ? `${rect.top - actionOffset - toPx(commonLength) / 2}px` : `${rect.bottom - actionOffset - toPx(commonLength) / 2}px`
  });
  return scaleArea;
}
export function getDeleteIcon(rect, customActionStyle) {
  const deleteArea = {
    type: 'rect',
    id: 'delete',
    css: {
      color: '#0000ff'
    }
  };
  if (customActionStyle && customActionStyle.delete) {
    Object.assign(deleteArea, {
      type: 'image',
      url: customActionStyle.delete.icon,
      css: {}
    });
  }
  const actionOffset = toPx(ACTION_OFFSET);
  const commonLength = `${48}rpx`;
  deleteArea.css = Object.assign({}, deleteArea.css, {
    align: 'center',
    left: `${rect.left - actionOffset}px`,
    top: `${rect.top - actionOffset - toPx(commonLength) / 2}px`,
    height: commonLength,
    width: commonLength,
    borderRadius: `${ACTION_DEFAULT_SIZE}rpx`
  });
  return deleteArea;
}