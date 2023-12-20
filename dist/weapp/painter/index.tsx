import { useState, useEffect, useRef, FC, CSSProperties } from 'react';
import Taro, { getApp, Canvas as CanvasType, getCurrentInstance } from '@tarojs/taro';
import { View, Canvas, Block } from '@tarojs/components';
import * as Painter from 'painter-kernel';
import Downloader from './lib/downloader';
import { isEmpty, isInView, isInDelete, isInScale, isNeedRefresh, getBox, getDeleteIcon, getScaleIcon } from './utils';
import WxCanvas from './lib/wx-canvas';
import './index.scss';

const downloader = new Downloader();
const MAX_PAINT_COUNT = 5;

export interface IView {
  type?: 'rect' | 'text' | 'image' | 'qrcode';
  text?: string;
  url?: string;
  id?: string;
  /** 事实上painter中view的css属性并不完全与CSSProperties一致。 */
  /** 有一些属性painter并不支持，而当你需要开启一些“高级”能力时，属性的使用方式也与css规范不一致。 */
  /** 具体的区别我们将在下方对应的view介绍中详细讲解，在这里使用CSSProperties仅仅是为了让你享受代码提示 */
  css: CSSProperties | any;
  content?: string;
  rect?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    x: number;
    y: number;
    minWidth?: number;
  };
}

interface IPalette {
  background?: string; // 整个模版的背景，支持网络图片的链接、纯色和渐变色
  width: string;
  height: string;
  borderRadius?: string;
  views: Array<IView>;
}

export interface IPainterProps {
  customStyle?: string;
  // 运行自定义选择框和删除缩放按钮
  customActionStyle?: {
    border?: {
      borderColor: string;
    };
    scale?: {
      textIcon: string;
      imageIcon: string;
    };
    delete?: {
      icon: string;
    };
  };
  customAction?: {
    [type: string]: {
      layout: (
        view: IView,
        viewRects: {
          [id: string]: {
            width: number;
            height: number;
            left: number;
            top: number;
            right: number;
            bottom: number;
          };
        },
      ) => {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };
      draw: (view: IView, ctx: CanvasRenderingContext2D) => Promise<void>;
    };
  };
  palette?: IPalette;
  dancePalette?: IPalette;
  // 缩放比，会在传入的 palette 中统一乘以该缩放比
  scaleRatio?: number;
  widthPixels?: number;
  // 启用脏检查，默认 false
  dirty?: boolean;
  LRU?: boolean;
  action?: { view: IView };
  disableAction?: boolean;
  clearActionBox?: boolean;
  use2D?: boolean;
  onImgOK?: (path: string) => void;
  onImgErr?: (error: any) => void;
  onViewUpdate?: (view: IView | undefined) => void;
  onViewClicked?: (view: IView | undefined) => void;
  onTouchEnd?: (detail: { view?: IView | undefined; type?: string; index?: number }) => void;
  onDidShow?: () => void;
}

interface IState {
  photoStyle: string;
  painterStyle: string;
  picURL: string;
  showCanvas: boolean;
}

interface IRefs {
  paintCount: number;
  outterDisabled: boolean;
  isDisabled: boolean;
  imgSize: any;
  needClear: boolean;
  touchedView?: IView | any;
  prevFindedIndex?: number;
  findedIndex: number;
  oldPalette?: IPalette;
  currentPalette: IPalette;
  block?: IPalette;
  startX: number;
  startY: number;
  startH: number;
  startW: number;
  isScale: boolean;
  startTimeStamp: number;
  hasMove: boolean;
  screenK: number;
  canvasWidthInPx: number;
  canvasHeightInPx: number;
  canvasNode: CanvasType | null;
  needScale: boolean;
}

const Index: FC<IPainterProps> = (props: IPainterProps) => {
  const [state, setData] = useState<Partial<IState>>({
    picURL: '',
    showCanvas: true,
    painterStyle: '',
  });
  const refs = useRef<IRefs>({
    imgSize: {},
    needClear: false,
    isDisabled: false,
    currentPalette: {
      width: '0rpx',
      height: '0rpx',
      background: '#ffffff',
      views: [],
    },
    findedIndex: -1,
    startX: 0,
    startY: 0,
    startH: 0,
    startW: 0,
    isScale: false,
    startTimeStamp: 0,
    hasMove: false,
    screenK: 0.5,
    paintCount: 0,
    canvasWidthInPx: 0,
    canvasHeightInPx: 0,
    outterDisabled: false,
    canvasNode: null,
    needScale: false,
  });
  const frontContext = useRef<WxCanvas>();
  const bottomContext = useRef<WxCanvas>();
  const topContext = useRef<WxCanvas>();
  const globalContext = useRef<WxCanvas>();
  const photoContext = useRef<WxCanvas>();
  const that = refs.current;

  function setState(params: Partial<IState>) {
    setData(pre => {
      return {
        ...pre,
        ...params,
      };
    });
  }

  useEffect(() => {
    Painter.initInjection({
      loadImage: async url => {
        return new Promise(resolve => {
          if (!that.imgSize[url]) {
            Taro.getImageInfo({
              src: url,
              success: res => {
                // 获得一下图片信息，供后续裁减使用
                that.imgSize[url] = {
                  img: url,
                  width: res.width,
                  height: res.height,
                };
                resolve(that.imgSize[url]);
              },
              fail: error => {
                // 如果图片坏了，则直接置空，防止坑爹的 canvas 画崩溃了
                resolve({
                  img: '',
                  width: 0,
                  height: 0,
                });
                console.error(`getImageInfo ${url} failed, ${JSON.stringify(error)}`);
              },
            }).catch(err => {
              //
            });
          } else {
            resolve(that.imgSize[url]);
          }
        });
      },
    });
  }, []);

  useEffect(() => {
    if (props.use2D) {
      Painter.initInjection({
        customActions: props.customAction,
      });
    }
  }, [props.customAction]);

  useEffect(() => {
    if (isNeedRefresh(props.palette, that.oldPalette, props.dirty)) {
      that.paintCount = 0;
      Painter.clearPenCache();
      that.oldPalette = JSON.parse(JSON.stringify(props.palette));
      startPaint();
    }
  }, [props.palette]);

  useEffect(() => {
    if (!isEmpty(props.dancePalette)) {
      Painter.clearPenCache();
      initDancePalette();
    }
  }, [props.dancePalette]);

  useEffect(() => {
    if (props.action && !isEmpty(props.action)) {
      doAction(props.action, true);
    }
  }, [props.action]);

  useEffect(() => {
    that.outterDisabled = props.disableAction || false;
    that.isDisabled = props.disableAction || false;
  }, [props.disableAction]);

  useEffect(() => {
    if (props.clearActionBox && !that.needClear) {
      if (frontContext.current) {
        setTimeout(() => {
          frontContext.current!.draw();
        }, 100);
        that.touchedView = {};
        that.prevFindedIndex = that.findedIndex;
        that.findedIndex = -1;
      }
    }
    that.needClear = props.clearActionBox || false;
  }, [props.clearActionBox]);

  function doAction(action?: { view: IView } | null, overwrite?: boolean) {
    if (props.use2D) {
      return;
    }
    const newVal: IView | undefined = action ? action.view : undefined;
    if (newVal && newVal.id && that.touchedView && that.touchedView.id !== newVal.id && that.currentPalette) {
      // 带 id 的动作给撤回时使用，不带 id，表示对当前选中对象进行操作
      const { views } = that.currentPalette;
      for (let i = 0; i < views.length; i++) {
        if (views[i].id === newVal.id) {
          // 跨层回撤，需要重新构建三层关系
          that.touchedView = views[i];
          that.findedIndex = i;
          sliceLayers();
          break;
        }
      }
    }
    const doView: any = that.touchedView;
    if (!doView || isEmpty(doView)) {
      return;
    }
    if (newVal && newVal.css) {
      if (overwrite) {
        doView.css = newVal.css;
      } else if (Array.isArray(doView.css) && Array.isArray(newVal.css)) {
        doView.css = Object.assign({}, ...doView.css, ...newVal.css);
      } else if (Array.isArray(doView.css)) {
        doView.css = Object.assign({}, ...doView.css, newVal.css);
      } else if (Array.isArray(newVal.css)) {
        doView.css = Object.assign({}, doView.css, ...newVal.css);
      } else {
        doView.css = Object.assign({}, doView.css, newVal.css);
      }
    }
    if (newVal && newVal.rect) {
      doView.rect = newVal.rect;
    }
    if (newVal && newVal.url && doView.url && newVal.url !== doView.url) {
      downloader
        .download(newVal.url, props.LRU)
        .then(path => {
          if (newVal.url!.startsWith('https')) {
            doView.originUrl = newVal.url;
          }
          doView.url = path;
          Taro.getImageInfo({
            src: path,
            success: res => {
              doView.sHeight = res.height;
              doView.sWidth = res.width;
              reDraw(doView);
            },
            fail: () => {
              reDraw(doView);
            },
          });
        })
        .catch(error => {
          // 未下载成功，直接绘制
          console.error(error);
          reDraw(doView);
        });
    } else {
      newVal && newVal.text && doView.text && newVal.text !== doView.text && (doView.text = newVal.text);
      newVal &&
        newVal.content &&
        doView.content &&
        newVal.content !== doView.content &&
        (doView.content = newVal.content);
      reDraw(doView);
    }
  }

  function reDraw(doView: IView) {
    const draw: any = {
      width: that.currentPalette.width,
      height: that.currentPalette.height,
      views: isEmpty(doView) ? [] : [doView],
    };
    const pen = new Painter.Pen((globalContext.current as unknown) as CanvasRenderingContext2D, draw);
    pen.paint(() => {
      globalContext.current!.draw();
      props.onViewUpdate && props.onViewUpdate(that.touchedView);
    });
    const { rect, css, type } = doView;
    that.block = {
      width: that.currentPalette.width,
      height: that.currentPalette.height,
      views: isEmpty(doView) ? [] : [getBox(rect, doView.type, props.customActionStyle)],
    };
    if (css && css.scalable) {
      that.block.views.push(getScaleIcon(rect, type, props.customActionStyle));
    }
    if (css && css.deletable) {
      that.block.views.push(getDeleteIcon(rect, props.customActionStyle));
    }
    const topBlock = new Painter.Pen((frontContext.current as unknown) as CanvasRenderingContext2D, that.block as any);
    topBlock.paint(() => {
      frontContext.current!.draw();
    });
  }

  function onClick() {
    const x = that.startX;
    const y = that.startY;
    const totalLayerCount = that.currentPalette.views.length;
    let canBeTouched: Array<{
      view: IView;
      index: number;
    }> = [];
    let isDelete = false;
    let deleteIndex = -1;
    for (let i = totalLayerCount - 1; i >= 0; i--) {
      const view = that.currentPalette.views[i];
      const { rect } = view;
      if (that.touchedView && that.touchedView.id && that.touchedView.id === view.id && isInDelete(x, y, that.block)) {
        canBeTouched.length = 0;
        deleteIndex = i;
        isDelete = true;
        break;
      }
      if (isInView(x, y, rect)) {
        canBeTouched.push({
          view,
          index: i,
        });
      }
    }
    that.touchedView = {};
    if (canBeTouched.length === 0) {
      that.findedIndex = -1;
    } else {
      let i = 0;
      const touchAble = canBeTouched.filter(item => Boolean(item.view.id));
      if (touchAble.length === 0) {
        that.findedIndex = canBeTouched[0].index;
      } else {
        for (i = 0; i < touchAble.length; i++) {
          if (that.findedIndex === touchAble[i].index) {
            i++;
            break;
          }
        }
        if (i === touchAble.length) {
          i = 0;
        }
        that.touchedView = touchAble[i].view;
        that.findedIndex = touchAble[i].index;
        props.onViewClicked && props.onViewClicked(that.touchedView);
      }
    }
    if (that.findedIndex < 0 || (that.touchedView && !that.touchedView.id)) {
      // 证明点击了背景 或无法移动的view
      frontContext.current && frontContext.current.draw();
      if (isDelete) {
        props.onTouchEnd &&
          props.onTouchEnd({
            view: that.currentPalette.views[deleteIndex],
            index: deleteIndex,
            type: 'delete',
          });
        doAction();
      } else if (that.findedIndex < 0) {
        props.onTouchEnd && props.onTouchEnd({});
      }
      that.findedIndex = -1;
      that.prevFindedIndex = -1;
    } else if (that.touchedView && that.touchedView.id) {
      sliceLayers();
    }
  }

  function sliceLayers() {
    const bottomLayers = that.currentPalette.views.slice(0, that.findedIndex);
    const topLayers = that.currentPalette.views.slice(that.findedIndex + 1);
    const bottomDraw: any = {
      width: that.currentPalette.width,
      height: that.currentPalette.height,
      background: that.currentPalette.background,
      views: bottomLayers,
    };
    const topDraw: any = {
      width: that.currentPalette.width,
      height: that.currentPalette.height,
      views: topLayers,
    };
    if (that.prevFindedIndex! < that.findedIndex) {
      new Painter.Pen((bottomContext.current as unknown) as CanvasRenderingContext2D, bottomDraw).paint(() => {
        bottomContext.current!.draw();
      });
      doAction();
      new Painter.Pen((topContext.current as unknown) as CanvasRenderingContext2D, topDraw).paint(() => {
        topContext.current!.draw();
      });
    } else {
      new Painter.Pen((topContext.current as unknown) as CanvasRenderingContext2D, topDraw).paint(() => {
        topContext.current!.draw();
      });
      doAction();
      new Painter.Pen((bottomContext.current as unknown) as CanvasRenderingContext2D, bottomDraw).paint(() => {
        bottomContext.current!.draw();
      });
    }
    that.prevFindedIndex = that.findedIndex;
  }

  function onTouchStart(event) {
    if (that.isDisabled) {
      return;
    }
    const { x, y } = event.touches[0];
    that.startX = x;
    that.startY = y;
    that.startTimeStamp = Date.now();
    if (that.touchedView && !isEmpty(that.touchedView)) {
      const { rect } = that.touchedView;
      if (isInScale(x, y, that.block) && rect) {
        that.isScale = true;
        that.startH = rect.bottom - rect.top;
        that.startW = rect.right - rect.left;
      } else {
        that.isScale = false;
      }
    } else {
      that.isScale = false;
    }
  }

  function onTouchEnd() {
    if (that.isDisabled) {
      return;
    }
    const current = Date.now();
    if (current - that.startTimeStamp <= 500 && !that.hasMove) {
      !that.isScale && onClick();
    } else if (that.touchedView && !isEmpty(that.touchedView)) {
      props.onTouchEnd &&
        props.onTouchEnd({
          view: that.touchedView,
        });
    }
    that.hasMove = false;
  }

  function onTouchMove(event) {
    if (that.isDisabled) {
      return;
    }
    that.hasMove = true;
    if (!that.touchedView || (that.touchedView && !that.touchedView.id)) {
      return;
    }
    const { x, y } = event.touches[0];
    const offsetX = x - that.startX;
    const offsetY = y - that.startY;
    const { rect, type } = that.touchedView;
    let css: CSSProperties = {};
    if (that.isScale) {
      Painter.clearPenCache(that.touchedView.id);
      const newW = that.startW + offsetX > 1 ? that.startW + offsetX : 1;
      if (that.touchedView.css && that.touchedView.css.minWidth) {
        if (newW < Painter.toPx(that.touchedView.css.minWidth)) {
          return;
        }
      }
      if (that.touchedView.rect && that.touchedView.rect.minWidth) {
        if (newW < that.touchedView.rect.minWidth) {
          return;
        }
      }
      const newH = that.startH + offsetY > 1 ? that.startH + offsetY : 1;
      css = {
        width: `${newW}px`,
      };
      if (type !== 'text') {
        if (type === 'image') {
          css.height = `${(newW * that.startH) / that.startW}px`;
        } else {
          css.height = `${newH}px`;
        }
      }
    } else {
      that.startX = x;
      that.startY = y;
      css = {
        left: `${rect!.x + offsetX}px`,
        top: `${rect!.y + offsetY}px`,
        right: undefined,
        bottom: undefined,
      };
    }
    doAction({
      view: {
        css,
      },
    });
  }

  function initScreenK() {
    if (!(getApp() && getApp().systemInfo && getApp().systemInfo.screenWidth)) {
      try {
        getApp().systemInfo = Taro.getSystemInfoSync();
      } catch (e) {
        console.error(`Painter get system info failed, ${JSON.stringify(e)}`);
        return;
      }
    }
    if (getApp().systemInfo && getApp().systemInfo.screenWidth) {
      that.screenK = getApp().systemInfo.screenWidth / 750;
    }
    Painter.setStringPrototype(that.screenK, props.scaleRatio);
  }

  function initDancePalette() {
    if (props.use2D) {
      return;
    }
    that.isDisabled = true;
    initScreenK();
    downloadImages(props.dancePalette).then(async (palette: any) => {
      that.currentPalette = palette;
      const { width, height } = palette;

      if (!width || !height) {
        console.error(`You should set width and height correctly for painter, width: ${width}, height: ${height}`);
        return;
      }
      setState({
        painterStyle: `width:${Painter.toPx(width)}px;height:${Painter.toPx(height)}px;`,
      });
      frontContext.current || (frontContext.current = await getCanvasContext(props.use2D, 'front'));
      bottomContext.current || (bottomContext.current = await getCanvasContext(props.use2D, 'bottom'));
      topContext.current || (topContext.current = await getCanvasContext(props.use2D, 'top'));
      globalContext.current || (globalContext.current = await getCanvasContext(props.use2D, 'k-canvas'));
      new Painter.Pen((bottomContext.current as unknown) as CanvasRenderingContext2D, palette).paint(() => {
        that.isDisabled = that.outterDisabled;
        bottomContext.current!.draw();
        props.onDidShow && props.onDidShow();
      });
      globalContext.current!.draw();
      frontContext.current!.draw();
      topContext.current!.draw();
    });
    that.touchedView = {};
  }

  function startPaint() {
    if (!props.palette) {
      return;
    }
    initScreenK();
    const { width, height } = props.palette!;
    if (!width || !height) {
      console.error(`You should set width and height correctly for painter, width: ${width}, height: ${height}`);
      return;
    }
    // 生成图片时，根据设置的像素值重新绘制
    if (that.canvasWidthInPx !== Painter.toPx(width)) {
      that.canvasWidthInPx = Painter.toPx(width);
      that.needScale = !!props.use2D;
    }
    if (props.widthPixels) {
      Painter.setStringPrototype(that.screenK, props.widthPixels / that.canvasWidthInPx);
      that.canvasWidthInPx = props.widthPixels;
    }

    if (that.canvasHeightInPx !== Painter.toPx(height)) {
      that.canvasHeightInPx = Painter.toPx(height);
      that.needScale = that.needScale || !!props.use2D;
    }
    const newPhotoStyle = `width:${that.canvasWidthInPx}px;height:${that.canvasHeightInPx}px;`;
    setState({
      photoStyle: state.photoStyle === newPhotoStyle ? newPhotoStyle + ';' : newPhotoStyle,
    });
  }

  useEffect(() => {
    downloadImages(props.palette).then(async (palette: any) => {
      if (palette === null) {
        return;
      }
      photoContext.current || (photoContext.current = await getCanvasContext(props.use2D, 'photo'));
      if (that.needScale) {
        const scale = getApp().systemInfo.pixelRatio;
        photoContext.current!.width = that.canvasWidthInPx * scale;
        photoContext.current!.height = that.canvasHeightInPx * scale;
        photoContext.current!.scale(scale, scale);
      }
      new Painter.Pen((photoContext.current as unknown) as CanvasRenderingContext2D, palette).paint(() => {
        photoContext.current!.draw();
        saveImgToLocal();
      });
      Painter.setStringPrototype(that.screenK, props.scaleRatio);
    });
  }, [state.photoStyle]);

  function downloadImages(palette) {
    return new Promise(resolve => {
      if (!palette) {
        resolve(null);
        return;
      }
      let preCount = 0;
      let completeCount = 0;
      const paletteCopy = JSON.parse(JSON.stringify(palette));
      if (paletteCopy.background) {
        preCount++;
        downloader.download(paletteCopy.background, props.LRU).then(
          path => {
            paletteCopy.background = path;
            completeCount++;
            if (preCount === completeCount) {
              resolve(paletteCopy);
            }
          },
          () => {
            completeCount++;
            if (preCount === completeCount) {
              resolve(paletteCopy);
            }
          },
        );
      }
      if (paletteCopy.views) {
        for (let i = 0; i < paletteCopy.views.length; i++) {
          const view = paletteCopy.views[i];
          if (view && view.type === 'image' && view.url) {
            preCount++;
            /* eslint-disable no-loop-func */
            downloader.download(view.url, props.LRU).then(
              path => {
                view.originUrl = view.url;
                view.url = path;
                completeCount++;
                if (preCount === completeCount) {
                  resolve(paletteCopy);
                }
              },
              () => {
                completeCount++;
                if (preCount === completeCount) {
                  resolve(paletteCopy);
                }
              },
            );
          }
        }
      }
      if (preCount === 0) {
        resolve(paletteCopy);
      }
    });
  }

  function saveImgToLocal() {
    setTimeout(() => {
      Taro.canvasToTempFilePath(
        {
          canvasId: 'photo',
          // @ts-ignore
          canvas: !!props.use2D ? that.canvasNode! : undefined,
          destWidth: that.canvasWidthInPx,
          destHeight: that.canvasHeightInPx,
        },
        getCurrentInstance(),
      )
        .then(res => {
          getImageInfo(res.tempFilePath);
        })
        .catch(error => {
          console.error(`canvasToTempFilePath failed, ${JSON.stringify(error)}`);
          props.onImgErr &&
            props.onImgErr({
              error,
            });
        });
    }, 300);
  }

  function getCanvasContext(use2D, id): Promise<WxCanvas> {
    return new Promise(resolve => {
      if (use2D) {
        const query = Taro.createSelectorQuery().in(getCurrentInstance().page!);
        const selectId = `#${id}`;
        query
          .select(selectId)
          .fields({ node: true, size: true })
          .exec(res => {
            that.canvasNode = res[0].node;
            const ctx = that.canvasNode!.getContext('2d');
            const wxCanvas = new WxCanvas('2d', ctx, id, true, that.canvasNode);
            resolve(wxCanvas);
          });
      } else {
        const temp = Taro.createCanvasContext(id, getCurrentInstance().page!);
        resolve(new WxCanvas('mina', temp, id, true));
      }
    });
  }

  function getImageInfo(filePath) {
    Taro.getImageInfo({
      src: filePath,
    })
      .then(infoRes => {
        if (that.paintCount > MAX_PAINT_COUNT) {
          const error = `The result is always fault, even we tried ${MAX_PAINT_COUNT} times`;
          console.error(error);
          props.onImgErr &&
            props.onImgErr({
              error,
            });
          return;
        }
        // 比例相符时才证明绘制成功，否则进行强制重绘制
        if (
          Math.abs(
            (infoRes.width * that.canvasHeightInPx - that.canvasWidthInPx * infoRes.height) /
              (infoRes.height * that.canvasHeightInPx),
          ) < 0.01
        ) {
          props.onImgOK && props.onImgOK(filePath);
        } else {
          startPaint();
        }
        that.paintCount++;
      })
      .catch(error => {
        console.error(`getImageInfo failed, ${JSON.stringify(error)}`);
        props.onImgErr &&
          props.onImgErr({
            error,
          });
      });
  }

  return (
    <View style={`position: relative;${props.customStyle};${state.painterStyle};`}>
      {props.use2D ? (
        <Block>
          <Canvas type="2d" id="photo" style={`${state.photoStyle}`} />
        </Block>
      ) : (
        <Block>
          <Canvas canvas-id="photo" style={`${state.photoStyle};position: absolute; left: -9999px; top: -9999rpx;`} />
          <Canvas canvas-id="bottom" style={`${state.painterStyle};position: absolute;`} />
          <Canvas canvas-id="k-canvas" style={`${state.painterStyle};position: absolute;`} />
          <Canvas canvas-id="top" style={`${state.painterStyle};position: absolute;`} />
          <Canvas
            canvas-id="front"
            style={`${state.painterStyle};position: absolute;`}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
            disableScroll
          />
        </Block>
      )}
    </View>
  );
};

Index.defaultProps = {
  scaleRatio: 1,
  widthPixels: 0,
  dirty: false,
  LRU: true,
};

export default Index;
