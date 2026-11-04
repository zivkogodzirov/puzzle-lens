# Puzzle Lens: functions exported from OpenCV into JavaScript.
#
# Format follows OpenCV's platforms/js/opencv_js.config.py (Apache-2.0), trimmed to what
# Puzzle Lens needs and with `cornerSubPix` added. The dnn and photo modules are switched off
# in build-opencv.sh, so nothing from them is listed here.
# See docs/RESEARCH.md §18.

core = {
    '': [
        'absdiff', 'add', 'addWeighted', 'bitwise_and', 'bitwise_not', 'bitwise_or', 'bitwise_xor',
        'cartToPolar', 'compare', 'convertScaleAbs', 'copyMakeBorder', 'countNonZero', 'determinant',
        'divide', 'eigen', 'exp', 'flip', 'gemm', 'hconcat', 'inRange', 'invert', 'kmeans', 'log',
        'magnitude', 'max', 'mean', 'meanStdDev', 'merge', 'min', 'minMaxLoc', 'mixChannels', 'multiply',
        'norm', 'normalize', 'perspectiveTransform', 'polarToCart', 'pow', 'reduce', 'repeat', 'rotate',
        'setIdentity', 'setRNGSeed', 'solve', 'split', 'sqrt', 'subtract', 'trace', 'transform',
        'transpose', 'vconcat', 'setLogLevel', 'getLogLevel', 'LUT',
    ],
    'Algorithm': [],
}

imgproc = {
    '': [
        'adaptiveThreshold', 'approxPolyDP', 'arcLength', 'bilateralFilter', 'blur', 'boundingRect',
        'boxFilter', 'calcHist', 'Canny', 'circle', 'compareHist', 'connectedComponents',
        'connectedComponentsWithStats', 'contourArea', 'convexHull', 'convexityDefects', 'cornerHarris',
        'cornerMinEigenVal', 'cornerSubPix', 'createCLAHE', 'cvtColor', 'dilate', 'distanceTransform',
        'distanceTransformWithLabels', 'drawContours', 'ellipse', 'equalizeHist', 'erode',
        'fillConvexPoly', 'fillPoly', 'filter2D', 'findContours', 'fitEllipse', 'fitLine', 'floodFill',
        'GaussianBlur', 'getAffineTransform', 'getPerspectiveTransform', 'getRectSubPix',
        'getRotationMatrix2D', 'getStructuringElement', 'goodFeaturesToTrack', 'grabCut', 'HuMoments',
        'integral', 'integral2', 'invertAffineTransform', 'isContourConvex', 'Laplacian', 'line',
        'matchShapes', 'matchTemplate', 'medianBlur', 'minAreaRect', 'minEnclosingCircle', 'moments',
        'morphologyEx', 'pointPolygonTest', 'polylines', 'putText', 'pyrDown', 'pyrUp', 'rectangle',
        'remap', 'resize', 'Scharr', 'sepFilter2D', 'Sobel', 'spatialGradient', 'sqrBoxFilter',
        'stackBlur', 'threshold', 'warpAffine', 'warpPerspective', 'watershed',
    ],
    'CLAHE': ['apply', 'collectGarbage', 'getClipLimit', 'getTilesGridSize', 'setClipLimit', 'setTilesGridSize'],
}

objdetect = {
    '': ['getPredefinedDictionary', 'drawDetectedMarkers', 'generateImageMarker'],
    'aruco_PredefinedDictionaryType': [],
    'aruco_Dictionary': ['Dictionary', 'getDistanceToId', 'generateImageMarker'],
    'aruco_DetectorParameters': ['DetectorParameters'],
    'aruco_RefineParameters': ['RefineParameters'],
    'aruco_ArucoDetector': ['ArucoDetector', 'detectMarkers', 'refineDetectedMarkers', 'setDictionary',
                            'setDetectorParameters', 'setRefineParameters'],
}

video = {
    '': ['calcOpticalFlowPyrLK', 'findTransformECC'],
}

features2d = {
    'Feature2D': ['detect', 'compute', 'detectAndCompute', 'descriptorSize', 'descriptorType', 'defaultNorm',
                  'empty', 'getDefaultName'],
    'ORB': ['create', 'setMaxFeatures', 'setScaleFactor', 'setNLevels', 'setEdgeThreshold', 'setFastThreshold',
            'setFirstLevel', 'setWTA_K', 'setScoreType', 'setPatchSize', 'getFastThreshold', 'getDefaultName'],
    'DescriptorMatcher': ['add', 'clear', 'empty', 'isMaskSupported', 'train', 'match', 'knnMatch',
                          'radiusMatch', 'clone', 'create'],
    'BFMatcher': ['isMaskSupported', 'create'],
}

calib3d = {
    '': [
        'findHomography', 'calibrateCameraExtended', 'decomposeHomographyMat', 'estimateAffine2D',
        'estimateAffinePartial2D', 'getOptimalNewCameraMatrix', 'initUndistortRectifyMap', 'Rodrigues',
        'solvePnP', 'solvePnPRansac', 'projectPoints', 'undistort', 'undistortPoints',
    ],
    'UsacParams': ['UsacParams'],
}

white_list = makeWhiteList([core, imgproc, objdetect, video, features2d, calib3d])
