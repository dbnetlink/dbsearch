$(function () {
    var $progress = $('#progress');
    var $editValueDialog = $('#editValueDialog');
    var $recordViewDialog = $('#recordViewDialog');
    var $tableSelectDialog = $('#tableSelectDialog');
    var $columnSelectDialog = $('#columnSelectDialog');
    var $accordion = $('#accordion');
    var $tableSelection = $("#tableSelection");
    var $columnSelection = $("#columnSelection");
    var $databaseDdl = $("#databaseDdl");
    var rowHighlightClass = "warning";
    var replacementMode = false;
    var panelTemplate = null;
    var $searchBtnText = $("#searchBtnText");
    var recordViewTemplate = null;

    $('#optionsTab').tab();
    $('#optionsTab a').click(function (e) {
        e.preventDefault()
        replacementMode = $(this).data("type") != "find"
        $('form #mode').val($(this).data("type"))
        if (replacementMode) {
            $(".replacement-text").show()
            $searchBtnText.text("Find & Replace")
        }
        else {
            $(".replacement-text").hide()
            $searchBtnText.text("Find")
        }
        $(this).tab('show')
    });
    
    $('form').click(function(){$('#runReplaceBtn').hide()})

    var saveEditValue = function (event) {
        var $row = $accordion.find("tr." + rowHighlightClass).removeClass(rowHighlightClass);
        var args = editArgs($row);
        args.value = $("#editValueText").val();
        $editValueDialog.attr("edit-row-id", $row.attr("id"))

        dbSearch.server.saveColumnValue("dbsearch", args);
    };

    var dbSearch = $.connection.dbSearch;
    dbSearch.client.tableSearchStart = function (name, tableName) {
        $progress.html("Searching <strong>" + tableName + "</strong> ... <span class='badge'></span>");
    };

    dbSearch.client.tableSearchEnd = function (name, tableName) {
        $progress.html("");
    };

    dbSearch.client.updateProgress = function (name, args) {
        $progress.find('span.badge').text(args.percentComplete + '%');
    };

    dbSearch.client.matchFound = function (name, args) {
        addPanel(args.tableName);

        var $lastPanel = $accordion.find('.panel-body:last');
        var $lastPanelHeading = $accordion.find('.panel-heading:last');

        $lastPanel.find('table').append("<tr><td/><td/><td><div class='action-buttons' style='whitespace:nowrap' role='group'></div></td></tr>")
        var tr = $lastPanel.find("tr:last");
        var id = "id" + new Date().getTime();
        tr.attr("id", id);
        tr.attr("columnname", args.columnName)
        tr.find("td:eq(0)").text(args.columnName);

        tr.find("td:eq(1)").html(highlightMatch(args.value));
        tr.data("primary-key", JSON.stringify(args.primaryKey));
        tr.data("column-name", args.columnName);

        if (!jQuery.isEmptyObject(args.primaryKey)) {
            tr.find("div.action-buttons").
                append(actionButton('', editValue, 'pencil', 'Update the value')).
                append(document.createTextNode(' ')).
                append(actionButton('', viewRecord, 'eye-open','View the entire record'));
        }

        var buttonGroup = $lastPanelHeading.find('.btn-group')
        var cb = buttonGroup.find("input[column-name='" + args.columnName + "']")

        if (cb.length == 0) {
            buttonGroup.append(
                $("<label/>", { "class": "btn btn-primary active" }).attr("title", "Include/Exclude matches for this column").append(
                    $("<input type='checkbox'/>").prop('checked', true).attr("column-name", args.columnName).change(filterColumn)
                ).append(
                    $("<span/>").text(args.columnName + " ")
                ).append(
                    $("<span/>", { "class": "badge" }).text("1")
                )
            )
        }
        else {
            var badge = cb.parent().find("span.badge");
            badge.text(parseInt(badge.text()) + 1);
        }

        var $badge = $accordion.find('.panel-heading:last').find('button.table-name').find('span.badge');
        $badge.text(parseInt($badge.text()) + 1);
    };

    var actionButton = function (text, method, icon, title, size, buttonType) {
        if (!size)
            size = 'xs';
            
        if (!buttonType)
            buttonType = 'primary';    
            
        var $btn = $('<button/>', { 'class': 'btn btn-' + buttonType + ' btn-' + size, 'data-toggle' : 'tooltip', 'title' : title }).click(method).append(
            $('<span/>', { 'class': 'glyphicon glyphicon-' + icon })
        ).append(
           document.createTextNode(' ')
        ).append($('<span/>').html(text))
        $btn.tooltip();

        return $btn;
    }

    dbSearch.client.searchEnded = function (name) {
        var tablesMatched = 0;
        var totalMatches = 0;

        $accordion.children().each(function () {
            tablesMatched++;
            totalMatches += parseInt($(this).find('.panel-heading').find('button.table-name').find('span.badge').text());
        });

        $progress.html("<h3 style='display:inline'><span class='label label-success'>Completed <span class='glyphicon glyphicon-ok'></span></span></h3> <span class='badge'>" + totalMatches + "</span> matches found in <span class='badge'>" + tablesMatched + "</span> tables");

        if (replacementMode) {
            var $btn = actionButton('<strong>Run Replacement</strong>', confirmReplacement, 'floppy-save', 'Replace all instances of matched text with replacement text', 'sm', 'warning');
            $btn.attr('id','runReplaceBtn').css('margin-left','20px');
            $progress.append($btn);
        }
    };

    dbSearch.client.showDatabases = function (name, databases) {
        for (var i = 0; i < databases.length; i++) {
            $databaseDdl.append("<option>" + databases[i] + "</option>");
        }

        var database = $databaseDdl.val();

        if (localStorage.getItem("DbSearchForm"))
            database = JSON.parse(localStorage.getItem("DbSearchForm"))["databaseDdl"]

        $databaseDdl.change(getTables).val(database).trigger("change");
    }

    dbSearch.client.saveColumnValueResult = function (name, args) {
        $editValueDialog.modal('hide');

        if (args.message != "")
            message(args.message);
        else {
            var id = $editValueDialog.attr("edit-row-id");
            $("#" + id).find('td:eq(1)').html(highlightMatch(args.value))
            message("Value updated", "success");
        }
    };

    dbSearch.client.showColumnValue = function (name, value) {
        $('#editValueText').val(value);
        $editValueDialog.modal('show');
    };


    dbSearch.client.showRecord = function (name, record) {
        if (!recordViewTemplate) {
            var source = $("#record-view-template").html();
            var recordViewTemplate = Handlebars.compile(source);
        }

        $recordViewDialog.find('.modal-body').html(recordViewTemplate({ record: record }));
        $recordViewDialog.modal('show');
    };

    dbSearch.client.showTables = function (name, tables) {
        var restore = ($tableSelection.find('tr.db-table').length == 0)
        $tableSelection.find('tr.db-table').remove();

        configureDbEntitySelection($tableSelection, tables, 'table');

        if (restore)
            restoreForm();
        else
            notifySelectedTables();
    };

    var highlightMatch = function (value) {
        return value.replace(/\[match\]/g, '<span class="match">').replace(/\[\/match\]/g, '</span>')
    }

    var selectColumns = function (event) {
        event.stopPropagation();
        var tableName = $(this).closest('tr').find("input[type='checkbox']").attr('table-name');
        var selectedColumns = $(this).closest('tr').find("input[type='hidden']").val();
        $columnSelectDialog.attr("table-name", tableName);
        $columnSelectDialog.attr("selected-columns", selectedColumns);
        dbSearch.server.columns("dbsearch", $("#databaseDdl").val(), tableName);
    };

    $.connection.hub.connectionSlow(function () {
        console.log('We are currently experiencing difficulties with the connection.')
    });

    $.connection.hub.error(function (error) {
        console.log('SignalR error: ' + error)
    });

    $.connection.hub.logging = true;

    $.connection.hub.start().done(function () {
        dbSearch.server.databases("dbsearch");

        $("#saveEditBtn").click(saveEditValue);

        $editValueDialog.on('hidden.bs.modal', function (e) {
            removeRowHighlight()
        });

        $recordViewDialog.on('hidden.bs.modal', function (e) {
            removeRowHighlight()
        });

        $tableSelectDialog.on('show.bs.modal', function (e) {
            selectTables()
        });

        $columnSelectDialog.on('show.bs.modal', function (e) {
            restoreSelectedColumns()
        });

        $tableSelectDialog.on('shown.bs.modal', function (e) {
            $(e.target).find('th:first').width($(e.target).find('td:first').width())
        });
        $columnSelectDialog.on('shown.bs.modal', function (e) {
            $(e.target).find('th:first').width($(e.target).find('td:first').width())
        });

        $tableSelectDialog.find('.btn-primary').click(function () {
            $tableSelectDialog.modal('hide');
            var selectedTables = {};

            $tableSelection.find("td").find("input[type='checkbox']:checked").each(function () {
                var $this = $(this);
                selectedTables[$this.attr('table-name')] = $this.closest('tr').find("input[type='hidden']").val().split(',');
            });

            var json = JSON.stringify(selectedTables);
            console.log(json);
            $('form').find("#selectedTables").val(json);

            notifySelectedTables();
        });

        $columnSelectDialog.find('.btn-primary').click(function () {
            $columnSelectDialog.modal('hide');
            var selectedColumns = [];

            $columnSelection.find("td").find("input[type='checkbox']:checked").each(function () {
                selectedColumns.push($(this).attr('column-name'))
            });

            assignSelectedColumns($columnSelectDialog.attr("table-name"), selectedColumns);
        });

        $('#searchBtn').click(runSearch);
    });
    
    var runSearch = function () {
        if ($("#searchTokenTxt").val() == "") {
            message("Please enter a search value");
            return;
        }

        if ($('form').find("#selectedTables").val().replace('{}','') == '') {
            message("Please select at least one table");
            $('#selectTablesBtn').click()
            return;
        }

        localStorage.setItem("DbSearchForm", JSON.stringify($('form').serializeJSON()));

        $accordion.empty();
        $progress.show();

        dbSearch.server.search("dbsearch", $('form').serializeJSON());
    }

    var removeRowHighlight = function () {
        $accordion.find("tr." + rowHighlightClass).removeClass(rowHighlightClass);
    };

    var viewRecord = function () {
        var row = $(this).closest("tr")
        row.addClass(rowHighlightClass);
        var args = editArgs(row);

        $recordViewDialog.find('.modal-title').html(row.closest("table").attr("table-name") + ' ' + row.data("primary-key"))

        dbSearch.server.getRecordValues("dbsearch", args);
    };

    var editValue = function () {
        var row = $(this).closest("tr")
        row.addClass(rowHighlightClass);
        var args = editArgs(row);

        $editValueDialog.find('.modal-title').html('Edit - ' + row.closest("table").attr("table-name") + ' - ' + row.data("column-name") + ' ' + row.data("primary-key"))

        dbSearch.server.getColumnValue("dbsearch", args);
    };

    var addPanel = function (tableName) {
        var id = "collapse" + tableName.replace(/\./g,'');
        if ($accordion.find("#" + id).length)
            return;

        if (!panelTemplate) {
            var source = $("#table-panel-template").html();
            var panelTemplate = Handlebars.compile(source);
        }

        $accordion.append(panelTemplate({ tableName: tableName, id: id }));
        $accordion.find('table:last').attr('table-name', tableName);
    };

    var message = function (text) {
        $('#message-line').text(text).show();
        window.setTimeout(function () { $('#message-line').hide() }, 3000)
    };

    var getTables = function () {
        dbSearch.server.tables("dbsearch", $("#databaseDdl").val());
    };
    
    var confirmReplacement = function () {
        var str = "You are about to replace <strong>" + $progress.find("span.badge:first").text() + "</strong>";
        str += " instance(s) of the search token <strong>'" + $('#searchTokenTxt').val() + "'</strong> with";
        str += " the value <strong>'" + $("#replaceTokenTxt").val() + "'</strong>. Please confirm."
        bootbox.confirm( str, runReplacement);
    };

    var runReplacement = function (result) {
        if (!result)
            return;
       runSearch();                 
    };

    var filterColumn = function () {
        var $this = $(this);
        var $label = $this.closest('label.btn');
        var $parentPanel = $this.closest(".panel");
        var $label = $this.parent();
        var columnName = $this.attr("column-name");
        var $columnRows = $parentPanel.find("tr[columnname='" + columnName + "']");

        if (this.checked) {
            $columnRows.show();
            $label.removeClass('filter-off');
        }
        else {
            $columnRows.hide()
            $label.addClass('filter-off');
        }

        var matches = 0;

        $parentPanel.find(".btn-group").find("input[type='checkbox']:checked").each(function () { matches += parseInt($(this).parent().find('span.badge').text()) });
        $parentPanel.find("button.table-name").find("span.badge").text(matches);

        matches = 0;

        $accordion.find("button.table-name").find("span.badge").each(function () { matches += parseInt($(this).text()) });
        $progress.find("span.badge:first").text(matches);
    };

    var restoreForm = function () {
        if (!localStorage.getItem("DbSearchForm"))
            return;

        var formData = JSON.parse(localStorage.getItem("DbSearchForm"));

        $("form").find(":input").each(function () {
            if (!formData[this.id])
                return;

            if ($(this).attr("type") == "checkbox")
                $(this).prop("checked", formData[this.id] == "on")
            else {
                $(this).val(formData[this.id]);
                switch (this.id) {
                    case "selectedTables":
                        selectTables();
                        notifySelectedTables();
                        break;
                }
            }
        });
    };
    
    var assignSelectedColumns = function (tableName, selectedColumns, clickRow) {
        var $row = $tableSelection.find("input[table-name='" + tableName + "']").closest('tr');
        $row.find("input[type='hidden']").val(selectedColumns.join(','));

        var $btn = $row.find(".btn-primary");
        $btn.find("span.badge").remove();

        if (selectedColumns.join(',') != '') {
            $btn.append($('<span/>').addClass('badge').text(selectedColumns.length.toString()))
        }

        if (clickRow)
            $row.click();
    }

    var selectTables = function () {
        $tableSelection.find("td").find("input[type='checkbox']:checked").click()

        if ($('#selectedTables').val() == '')
            return;

        var tables = JSON.parse($('#selectedTables').val());
        for (var tableName in tables) {
            assignSelectedColumns(tableName, tables[tableName], true);
        }
    }

    var restoreSelectedColumns = function () {
        var columns = $columnSelectDialog.attr("selected-columns").split(',')
        for (var i = 0; i < columns.length ; i++) {
            $columnSelectDialog.find("input[column-name='" + columns[i] + "']").click();
        }
    }
   
    var notifySelectedTables = function () {
        var selectedTables = $tableSelection.find("td").find("input[type='checkbox']:checked").length
        $('#selectTablesBtn').find('span.badge').text(selectedTables).attr('title', selectedTables + ' table(s) selected');
    };

    var editArgs = function (row) {
        var args = {};
        args.primaryKey = JSON.parse(row.data("primary-key"))
        args.columnName = row.data("column-name")
        args.tableName = row.closest("table").attr("table-name")
        args.database = $databaseDdl.val();
        return args;
    };

    dbSearch.client.showColumns = function (name, columns) {
        configureDbEntitySelection($columnSelection, columns, 'column');
        $columnSelectDialog.modal('show');
    };

    var configureDbEntitySelection = function ($table, entities, entityType) {
        $table.find('tr.db-' + entityType).remove();

        for (var i = 0; i < entities.length; i++) {
            $table.append('<tr><td>' + entities[i] + '</td><td><input type="checkbox"></td></tr>')
            var tr = $table.find("tr:last");
            tr.addClass("db-" + entityType).find("td:first").text(entities[i] + ' ');
            tr.find("td:last").css("text-align", "center");
            tr.find("input").attr(entityType + "-name", entities[i]);

            if (entityType == 'table') {
                var btn = actionButton('', selectColumns, 'list', 'Select columns');
                btn.hide();
                tr.find("td:first").append(btn);
                tr.find("td:first").append('<input type="hidden" class=="selected-columns"/>');
            }
        }

        $table.find("tr").click(function (event) {
            if ($(event.target).prop("tagName") != "INPUT") {
                var cb = $(this).find("input[type='checkbox']");
                cb.prop("checked", cb.prop("checked") == false);
            }

            if ($(this).hasClass("header-row")) {
                var checked = $(this).find("input[type='checkbox']").prop("checked");
                $table.find("td").find("input[type='checkbox']:" + (checked ? "not(:checked)" : "checked")).click();
            }
            else {
                $(this).toggleClass("success");

                var btn = $(this).find('button');
                $(this).hasClass("success") ? btn.show() : btn.hide();
            }

            event.stopPropagation();
        });
    }

});
