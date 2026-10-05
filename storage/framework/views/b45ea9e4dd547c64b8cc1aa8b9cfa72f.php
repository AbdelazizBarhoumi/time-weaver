<!DOCTYPE html>
<html lang="<?php echo e(str_replace('_', '-', app()->getLocale())); ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="<?php echo e(csrf_token()); ?>">

    <title><?php echo e(config('app.name', 'Time Weaver')); ?></title>

    <?php echo app('Illuminate\Foundation\Vite')->reactRefresh(); ?>
    <?php echo app('Illuminate\Foundation\Vite')('resources/js/start.tsx'); ?>
</head>
<body>
    <div id="app"></div>
</body>
</html><?php /**PATH D:\projects\time-weaver\resources\views/app.blade.php ENDPATH**/ ?>