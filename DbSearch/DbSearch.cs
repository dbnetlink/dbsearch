using System;
using System.Web;
using System.Data;
using Microsoft.AspNet.SignalR;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Configuration;
using Newtonsoft.Json.Linq;
using System.Web.Script.Serialization;
using DbNetLink.Data;
using System.Linq;


namespace DbNetLink
{
    public class DbSearch : Hub
    {
        private static Regex searchPatternRe;

        public void Search(string name, Dictionary<string,object> parameters)
        {
            Dictionary<string, object> selectedTables = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(parameters["selectedTables"].ToString());

            searchPatternRe = CreateSearchExpression(parameters);

            using (DbNetData db = new DbNetData(parameters["databaseDdl"].ToString()))
            {
                db.VerboseErrorInfo = true;
                db.Open();

                switch (db.Database)
                {
                    case DatabaseType.SqlServer:
                        db.ExecuteNonQuery("set transaction isolation level read uncommitted");
                        break;
                }

                var tables = db.MetaDataCollection(MetaDataType.UserTables);

                foreach (DataRow table in tables.Rows)
                {
                    string tableName = table["table_name"].ToString();
                    string schemaName = table["table_schema"].ToString();

                    if (schemaName != String.Empty)
                        tableName = schemaName + "." + tableName; 

                    string dbTableName = db.QualifiedDbObjectName(tableName);

                    if (!selectedTables.ContainsKey(tableName))
                        continue;

                    Clients.Caller.tableSearchStart("dbsearch", tableName);

                    List<string> searchableColumns = SearchableColumns(dbTableName, db);

                    if (searchableColumns.Count == 0)
                        continue;

                    var selectedColumns = Array.ConvertAll(selectedTables[tableName] as object[], x => x.ToString());  

                    if (selectedColumns.Count() > 0 && selectedColumns.First() != String.Empty)
                        searchableColumns = new List<string>(selectedColumns);
                       
                    List<string> primaryKeyColumns = PrimaryKeyColumns(dbTableName, db);

                    QueryCommandConfig query = new QueryCommandConfig();
                    query.Sql = "select count(*) from " + dbTableName;
                    db.ExecuteSingletonQuery(query);

                    var count = Convert.ToInt32(db.ReaderValue(0));
                    var currentRow = 0;
                    int percentComplete = 0;

                    List<string> selectColumns = new List<string>();
                    List<string> columns = new List<string>();
                    columns.AddRange(searchableColumns);
                    columns.AddRange(primaryKeyColumns);

                    foreach (string columnName in columns.Distinct())
                        selectColumns.Add(db.QualifiedDbObjectName(columnName));

                    query = new QueryCommandConfig();
                    query.Sql = String.Format("select {0} from {1}", String.Join(",", selectColumns.Distinct().ToArray()), dbTableName);

                    db.ExecuteQuery(query);

                    while (db.Reader.Read())
                    {
                        currentRow++;

                        var pc = (currentRow * 100) / count;

                        if (pc > percentComplete)
                        {
                            percentComplete = pc;
                            Clients.Caller.updateProgress("dbsearch", new { tableName = tableName, percentComplete = percentComplete });
                        }

                        Dictionary<string,object> primaryKey = new Dictionary<string,object>();

                        var fieldCount = db.Reader.FieldCount;

                        for (var i = 0; i < fieldCount; i++)
                        {
                            var columnName = db.Reader.GetName(i);
                            if (primaryKeyColumns.Contains(columnName))
                            {
                                primaryKey.Add(columnName, db.Reader.GetValue(i));
                            }
                        }

                        for (var i = 0; i < fieldCount; i++)
                        {
                            var columnName = db.Reader.GetName(i);
                            if (primaryKeyColumns.Contains(columnName))
                                continue;
                            if (db.Reader.GetFieldType(i) == typeof(string))
                            {
                                if (searchPatternRe.IsMatch(db.ReaderString(i)))
                                {
                                    var value = HighlightMatch(db.ReaderString(i));

                                    Clients.Caller.matchFound("dbsearch", new { tableName = tableName, columnName = columnName, value = value, text = HttpUtility.HtmlEncode(db.ReaderString(i)), primaryKey = primaryKey });
                                }
                            }
                        }
                    }

                    db.Reader.Close();
                    Clients.Caller.tableSearchEnd("dbsearch", tableName);
                }
            }

            Clients.Caller.searchEnded("dbsearch");
        }

        public void Tables(string name, string database)
        {
            List<string> tables = new List<string>();

            using (DbNetData db = new DbNetData(database))
            {
                db.Open();

                var tbls = db.MetaDataCollection(MetaDataType.UserTables);

                foreach (DataRow table in tbls.Rows)
                {
                    var tableName = table["table_name"].ToString();
                    var tableSchema = table["table_schema"].ToString();
                    if (tableSchema != String.Empty)
                        tableName = tableSchema + "." + tableName;
                    tables.Add(tableName);
                }
            }

            Clients.Caller.showTables("dbsearch", tables.OrderBy(c => c).ToList());
        }

        public void Columns(string name, string database, string tableName)
        {
            List<string> columns = new List<string>();

            using (DbNetData db = new DbNetData(database))
            {
                db.Open();

                var schema = db.GetSchemaTable(tableName);

                foreach (DataRow column in schema.Rows)
                {
                    if (((Type)column["DataType"]).Name == "String")
                        columns.Add(column["ColumnName"].ToString());
                }
            }

            Clients.Caller.showColumns("dbsearch", columns);
        }

        public void Databases(string name)
        {
            List<string> databases = new List<string>();

            foreach (ConnectionStringSettings cs in ConfigurationManager.ConnectionStrings)
            {
                databases.Add(cs.Name);
            }

            Clients.Caller.showDatabases("dbsearch", databases);
        }

        private List<string> PrimaryKeyColumns(string tableName, DbNetData db)
        {
            List<string> columns = new List<string>();

            DataTable schemaTable = db.GetSchemaTable("select * from " + tableName + " where 1=2");

            foreach (DataRow row in schemaTable.Rows)
            {
                if ((row["DataType"] as Type).Name == "SqlHierarchyId")
                    return new List<string>();

                if (Convert.ToBoolean(row["IsKey"]))
                    columns.Add(Convert.ToString(row["ColumnName"]));
            }

            return columns;
        }

        private List<string> SearchableColumns(string tableName, DbNetData db)
        {
            List<string> columns = new List<string>();

            db.ExecuteSingletonQuery("select * from " + tableName + " where 1=2");

            for (var i = 0; i < db.Reader.FieldCount; i++)
                if (db.Reader.GetFieldType(i) == typeof(string))
                    columns.Add(db.Reader.GetName(i));

            return columns;
        }

        public void GetColumnValue(string name, Dictionary<string, object> parameters)
        {
            string value = String.Empty;

            using (DbNetData db = new DbNetData(parameters["database"].ToString()))
            {
                db.Open();
                QueryCommandConfig query = BuildRecordQuery(parameters, db);
                if (db.ExecuteSingletonQuery(query))
                    value = db.ReaderString(0);
            }

            Clients.Caller.showColumnValue("dbsearch", value);
        }

        public void GetRecordValues(string name, Dictionary<string, object> parameters)
        {
            parameters["columnName"] = "*";
            var record = new Dictionary<string, object>();

            using (DbNetData db = new DbNetData(parameters["database"].ToString()))
            {
                db.Open();
                QueryCommandConfig query = BuildRecordQuery(parameters, db);
                if (db.ExecuteSingletonQuery(query))
                    for (var i = 0; i < db.Reader.FieldCount; i++)
                        if (db.Reader.IsDBNull(i))
                            record[db.Reader.GetName(i)] = String.Empty;
                        else
                            record[db.Reader.GetName(i)] = HttpUtility.HtmlEncode(db.Reader.GetValue(i).ToString());
            }

            Clients.Caller.showRecord("dbsearch", record);
        }


        private QueryCommandConfig BuildRecordQuery(Dictionary<string, object> parameters, DbNetData db)
        {
            QueryCommandConfig query = new QueryCommandConfig();

            var dbTableName = db.QualifiedDbObjectName(parameters["tableName"].ToString());
            var dbColumnName = parameters["columnName"].ToString();

            if (dbColumnName != "*")
                dbColumnName = db.QualifiedDbObjectName(dbColumnName);

            query.Sql = String.Format("select {0} from {1}", dbColumnName, dbTableName);

            JContainer primaryKey = parameters["primaryKey"] as JContainer;

            foreach (JToken token in primaryKey.Children())
            {
                if (token is JProperty)
                {
                    var prop = token as JProperty;
                    query.Params[prop.Name] = (prop.Value as JValue).Value;
                }
            }

            return query;
        }


        public void SaveColumnValue(string name, Dictionary<string, object> parameters)
        {
            UpdateCommandConfig update = new UpdateCommandConfig();

            update.Sql = parameters["tableName"].ToString();
            update.Params[parameters["columnName"].ToString()] = parameters["value"];

            JContainer primaryKey = parameters["primaryKey"] as JContainer;

            foreach (JToken token in primaryKey.Children())
            {
                if (token is JProperty)
                {
                    var prop = token as JProperty;
                    update.FilterParams[prop.Name] = (prop.Value as JValue).Value;
                }
            }

            string msg = String.Empty;
            string value = parameters["value"].ToString();

            try
            {
                using (DbNetData db = new DbNetData(parameters["database"].ToString()))
                {
                    db.Open();
                    db.ExecuteUpdate(update);
                    value = HighlightMatch(value);
                }
            }
            catch (Exception ex)
            {
                msg = ex.Message;
            }

            Clients.Caller.saveColumnValueResult("dbsearch", new { message = msg, value = value});
        }

        private string HighlightMatch(string text)
        {
            return HttpUtility.HtmlEncode(searchPatternRe.Replace(text, "[match]$0[/match]"));
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="parameters"></param>
        /// <returns></returns>
        private Regex CreateSearchExpression(Dictionary<string, object> parameters)
        {
            var searchToken = parameters["searchTokenTxt"].ToString();
            bool caseSensitive = parameters["matchCaseCb"].ToString() == "on";
            bool useRegularExpression = parameters["useRegexCb"].ToString() == "on";
            bool wholeWordOnly = parameters["matchWholeWordCb"].ToString() == "on";

            RegexOptions regexOptions = RegexOptions.Compiled;
            if (!caseSensitive)
                regexOptions = regexOptions | RegexOptions.IgnoreCase;

            var searchPattern = searchToken;

            // If we are not using regular expression matching then escape any characters that may be interpreted as such
            if (!useRegularExpression)
                searchPattern = Regex.Escape(searchPattern);

            if (wholeWordOnly)
                searchPattern = String.Format("{0}" + searchPattern + "{0}", @"\b");

            Regex regex = new Regex(searchPattern, regexOptions);

            return regex;
        }
    }
}