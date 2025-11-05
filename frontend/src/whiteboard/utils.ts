import {
    IMAGE_NODE_HEADER_HEIGHT,
    IMAGE_NODE_MAX_CONTENT_HEIGHT,
    IMAGE_NODE_MAX_CONTENT_WIDTH,
    IMAGE_NODE_MIN_CONTENT_HEIGHT,
    IMAGE_NODE_MIN_HEIGHT,
    IMAGE_NODE_MIN_WIDTH,
} from './constants';

export function calculateImageNodeBounds(imageWidth: number, imageHeight: number) {
    if (!(imageWidth > 0) || !(imageHeight > 0)) {
        return { width: IMAGE_NODE_MIN_WIDTH, height: IMAGE_NODE_MIN_HEIGHT };
    }

    let contentWidth = imageWidth;
    let contentHeight = imageHeight;

    const widthScale = IMAGE_NODE_MAX_CONTENT_WIDTH / contentWidth;
    const heightScale = IMAGE_NODE_MAX_CONTENT_HEIGHT / contentHeight;
    const scale = Math.min(1, widthScale, heightScale);

    if (scale < 1) {
        contentWidth = Math.round(contentWidth * scale);
        contentHeight = Math.round(contentHeight * scale);
    }

    contentWidth = Math.max(IMAGE_NODE_MIN_WIDTH, contentWidth);
    contentHeight = Math.max(IMAGE_NODE_MIN_CONTENT_HEIGHT, contentHeight);

    return {
        width: contentWidth,
        height: contentHeight + IMAGE_NODE_HEADER_HEIGHT,
    };
}

export function getImageContentHeight(totalHeight: number) {
    return Math.max(IMAGE_NODE_MIN_CONTENT_HEIGHT, totalHeight - IMAGE_NODE_HEADER_HEIGHT);
}
